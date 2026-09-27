import { QueryClient } from '@tanstack/react-query';
import { registerSyncHandler, SYNC_QUERY_KEY } from '../sync/syncTrigger';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000 } },
});

// Queued writes ask for a sync (src/sync/syncTrigger.ts). cancelRefetch: false joins a sync that
// is already running instead of abandoning it — runSync can't be aborted, and its own lock
// (src/sync/runSync.ts) would make a second call wait for the first anyway.
registerSyncHandler(() => {
  void queryClient.refetchQueries({ queryKey: SYNC_QUERY_KEY }, { cancelRefetch: false });
});
