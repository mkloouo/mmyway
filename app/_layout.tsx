import { useEffect } from 'react';
import { AppState, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/providers/queryClient';
import { DbProvider } from '../src/providers/DbProvider';
import { useSync } from '../src/sync/useSync';
import { useTheme } from '../src/ui/theme';
import { Button } from '../src/ui/components';
import { useSharedImages } from '../src/receipt/useSharedImages';
import { installLogCapture, logLine } from '../src/utils/log';

installLogCapture();

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
      if (age > RESUME_SYNC_AFTER_MS) syncNow();
    });
    return () => subscription.remove();
  }, [syncNow, lastSyncedAt]);
  return null;
}

/** This build has no dev tools attached — a crash must never be a blank screen (design §7). */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const t = useTheme();
  logLine('error', `render crash: ${error.message}\n${error.stack ?? ''}`);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space.lg, padding: t.space.xxl, backgroundColor: t.color.bg }}>
      <Text style={[t.type.heading, { color: t.color.text }]}>Something broke</Text>
      <Text style={[t.type.body, { color: t.color.textMuted, textAlign: 'center' }]}>{error.message}</Text>
      <Button title="Reload" onPress={retry} />
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
            <SyncOnResume />
            <ShareIntentBridge />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="capture" options={{ presentation: 'modal' }} />
              <Stack.Screen name="receipt" options={{ presentation: 'modal' }} />
              <Stack.Screen name="draft/[id]" options={{ presentation: 'modal' }} />
              <Stack.Screen name="count" options={{ presentation: 'modal' }} />
            </Stack>
          </DbProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
