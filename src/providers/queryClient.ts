import { QueryClient } from '@tanstack/react-query';
import { registerSyncHandler, SYNC_QUERY_KEY } from '../sync/syncTrigger';
import { runSync, type SyncSummary } from '../sync/runSync';
import { getDb } from '../db/client';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000 } },
});

// A queued write asks for a push (src/sync/syncTrigger.ts): the outbox replay alone, not a full
// fetch. It goes straight to runSync rather than through the React Query sync query, so a write
// never starts a reference pull or spins a list's refresh indicator; the queue's own live rows
// (Inbox, the status pill's Queued count) show it draining.
//
// A push probes Firefly III too, so its answer updates what the status pill and the Sync sheet
// show: they kept saying "Offline" or "Sync error" from the last full sync after a push got
// through. The rest (receipt readers, last synced) stays from that full sync.
registerSyncHandler(() => {
  void runSync(getDb(), 'push').then((push) => {
    if (!push.signedIn) return;
    queryClient.setQueryData<SyncSummary>(SYNC_QUERY_KEY, (last) =>
      last
        ? {
            ...last,
            ff3: push.ff3,
            ff3Reachable: push.ff3Reachable,
            error: push.error,
            failedAt: push.failedAt,
          }
        : last,
    );
  });
});
