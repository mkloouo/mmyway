import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/providers/queryClient';
import { DbProvider } from '../src/providers/DbProvider';

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <DbProvider>
        <Stack />
      </DbProvider>
    </QueryClientProvider>
  );
}
