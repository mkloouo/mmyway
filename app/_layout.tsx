import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { queryClient } from '../src/providers/queryClient';
import { DbProvider, useDb } from '../src/providers/DbProvider';
import { useSync } from '../src/sync/useSync';
import { syncPlannedNotifications } from '../src/planned/notifications';
import { navigateOnce } from '../src/ui/navigateOnce';
import { useTheme } from '../src/ui/theme';
import { Button } from '../src/ui/components';
import { useSharedImages } from '../src/receipt/useSharedImages';
import { installLogCapture, logLine } from '../src/utils/log';
import '../src/i18n';
import { LocaleSync } from '../src/i18n/LocaleSync';
import NetInfo from '@react-native-community/netinfo';
import { registerBackgroundSync } from '../src/sync/backgroundSync';

installLogCapture();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const MODAL = { presentation: 'modal', animation: 'slide_from_bottom' } as const;

function ShareIntentBridge() {
  useSharedImages();
  return null;
}

// Mounting the sync query covers app launch. A resume only re-syncs when the last full sync is
// old — every app switch used to trigger a full fetch. Pull-to-refresh and Sync now are the
// manual way to fetch sooner; writes push themselves (src/sync/syncTrigger.ts).
const RESUME_SYNC_AFTER_MS = 30 * 60 * 1000;

function SyncOnResume() {
  const { syncNow, summary } = useSync();
  const lastSyncedAt = summary?.lastSyncedAt ?? null;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const age = lastSyncedAt ? Date.now() - new Date(lastSyncedAt).getTime() : Infinity;
      if (age > RESUME_SYNC_AFTER_MS) void syncNow();
    });
    return () => subscription.remove();
  }, [syncNow, lastSyncedAt]);
  return null;
}

// Brief §5.4: going back online sends what was queued offline without waiting for a resume.
function SyncOnReconnect() {
  const { syncNow } = useSync();
  useEffect(() => {
    let online: boolean | null = null;
    return NetInfo.addEventListener((state) => {
      const next = state.isConnected === true && state.isInternetReachable !== false;
      if (online === false && next) void syncNow();
      online = next;
    });
  }, [syncNow]);
  return null;
}

function BackgroundSyncRegistration() {
  useEffect(() => {
    void registerBackgroundSync();
  }, []);
  return null;
}

function PlannedNotificationListener() {
  const db = useDb();
  const handledResponseId = useRef<string | null>(null);

  useEffect(() => {
    void syncPlannedNotifications(db);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncPlannedNotifications(db);
      }
    });
    return () => subscription.remove();
  }, [db]);

  useEffect(() => {
    const handleResponse = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handledResponseId.current === id) return;
      handledResponseId.current = id;

      const data = response.notification.request.content.data;
      if (data && typeof data.plannedKey === 'string') {
        navigateOnce(`/planned/${encodeURIComponent(data.plannedKey)}`);
      }
    };

    void Notifications.getLastNotificationResponseAsync().then(handleResponse);

    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => subscription.remove();
  }, []);

  return null;
}

/** This build has no dev tools attached — a crash must never be a blank screen (design §7). */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  // In the render body this logged the same crash again on every re-render of the error screen.
  useEffect(() => {
    logLine('error', `render crash: ${error.message}\n${error.stack ?? ''}`);
  }, [error]);
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: t.space.lg,
        padding: t.space.xxl,
        backgroundColor: t.color.bg,
      }}
    >
      <Text style={[t.type.heading, { color: t.color.text }]}>{tr('errorBoundary.title')}</Text>
      <Text style={[t.type.body, { color: t.color.textMuted, textAlign: 'center' }]}>
        {error.message}
      </Text>
      <Button title={tr('errorBoundary.reload')} onPress={retry} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* expo-router's own SafeAreaProvider (via ExpoRoot) only seeds initialMetrics on web, so
          on Android every screen still measures insets on the first frame and jumps once real
          values land. This inner provider seeds it synchronously so nothing needs to remeasure. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          {/* Android defaults to light status-bar content, which was white glyphs on the app's
              near-white background. `auto` follows the colour scheme. */}
          <StatusBar style="auto" />
          <DbProvider>
            <LocaleSync />
            <SyncOnResume />
            <SyncOnReconnect />
            <BackgroundSyncRegistration />
            <PlannedNotificationListener />
            <ShareIntentBridge />
            {/* A push fades rather than sliding in from the side: these screens are a drill-down
                into what the tab already showed, and the slide read as a different place. The
                modals keep rising from the bottom — that is what tells them apart from a push. */}
            <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="capture" options={MODAL} />
              <Stack.Screen name="receipt" options={MODAL} />
              <Stack.Screen name="draft/[id]" options={MODAL} />
              <Stack.Screen name="count" options={MODAL} />
            </Stack>
          </DbProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
