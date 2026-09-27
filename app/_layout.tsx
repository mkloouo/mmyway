import { useEffect } from 'react';
import { AppState, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/providers/queryClient';
import { DbProvider } from '../src/providers/DbProvider';
import { useSync } from '../src/sync/useSync';
import { useTheme } from '../src/ui/theme';
import { Button } from '../src/ui/components';
import { useSharedImages } from '../src/receipt/useSharedImages';

function ShareIntentBridge() {
  useSharedImages();
  return null;
}

function SyncOnResume() {
  const { syncNow } = useSync(); // mounting the query already covers "sync on app open"
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncNow();
    });
    return () => subscription.remove();
  }, [syncNow]);
  return null;
}

/** This build has no dev tools attached — a crash must never be a blank screen (design §7). */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const t = useTheme();
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
      <QueryClientProvider client={queryClient}>
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
    </GestureHandlerRootView>
  );
}
