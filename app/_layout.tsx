import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/providers/queryClient';
import { DbProvider } from '../src/providers/DbProvider';
import { useSync } from '../src/sync/useSync';

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

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <DbProvider>
        <SyncOnResume />
        <Stack />
      </DbProvider>
    </QueryClientProvider>
  );
}
