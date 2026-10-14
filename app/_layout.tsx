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
import {
  registerPlannedNotificationCategories,
  syncPlannedNotifications,
} from '../src/planned/notifications';
import { navigateOnce } from '../src/ui/navigateOnce';
import { PickerHost } from '../src/ui/PickerHost';
import { useTheme } from '../src/ui/theme';
import { Button } from '../src/ui/kit';
import { useSharedImages } from '../src/receipt/useSharedImages';
import { installLogCapture, logLine } from '../src/utils/log';
import { loadProxyHeaders } from '../src/api/ff3/proxyHeaders';
import '../src/i18n';
import { LocaleSync } from '../src/i18n/LocaleSync';
import { LockGate } from '../src/lock/LockGate';
import NetInfo from '@react-native-community/netinfo';
import { registerBackgroundSync } from '../src/sync/backgroundSync';
import { FlagsSync } from '../src/flags/FlagsSync';

installLogCapture();

// Fills the snapshot every FF3 request merges (src/api/ff3/proxyHeaders.ts). At module scope so it
// is in flight before the first screen mounts; the sign-in path awaits it itself, since that is the
// only moment a request can beat this.
void loadProxyHeaders();

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
    let timer: ReturnType<typeof setTimeout> | null = null;
    return NetInfo.addEventListener((state) => {
      const next = state.isConnected === true && state.isInternetReachable !== false;
      if (online === false && next) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void syncNow();
        }, 1000);
      }
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
    void registerPlannedNotificationCategories();
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
      const action = response.actionIdentifier;
      if (action === 'move' && typeof data?.accountId === 'string') {
        navigateOnce({ pathname: '/capture', params: { type: 'transfer', to: data.accountId } });
        return;
      }
      if (data && typeof data.plannedKey === 'string') {
        const key = encodeURIComponent(data.plannedKey);
        // Skip goes to the item, which asks for confirmation: never a skip straight from the banner.
        if (action === 'skip' && typeof data.dueDate === 'string') {
          navigateOnce({ pathname: '/planned/[key]', params: { key, skip: data.dueDate } });
        } else {
          navigateOnce(`/planned/${key}`);
        }
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
  const t = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.color.bg }}>
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
            <FlagsSync />
            <SyncOnReconnect />
            <BackgroundSyncRegistration />
            <PlannedNotificationListener />
            <ShareIntentBridge />
            {/* A push fades rather than sliding in from the side: these screens are a drill-down
                into what the tab already showed, and the slide read as a different place. The
                modals keep rising from the bottom — that is what tells them apart from a push. */}
            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'fade',
                contentStyle: { backgroundColor: t.color.bg },
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="capture" options={MODAL} />
              <Stack.Screen name="receipt" options={MODAL} />
              <Stack.Screen name="draft/[id]" options={MODAL} />
              <Stack.Screen name="count" options={MODAL} />
              <Stack.Screen name="accounts/new" options={MODAL} />
              <Stack.Screen name="planned/new" options={MODAL} />
            </Stack>
            {/* Last inside the provider, so the overlay covers the modals too, not just the tabs. */}
            <LockGate />
            <PickerHost />
          </DbProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
