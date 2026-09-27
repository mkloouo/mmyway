import { QueryClient } from '@tanstack/react-query';
import { registerSyncHandler } from '../sync/syncTrigger';
import { runSync } from '../sync/runSync';
import { getDb } from '../db/client';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000 } },
});

// A queued write asks for a push (src/sync/syncTrigger.ts): the outbox replay alone, not a full
// fetch. It goes straight to runSync rather than through the React Query sync query, so a write
// never starts a reference pull or spins a list's refresh indicator; the queue's own live rows
// (Inbox, the status pill's Queued count) show it draining.
registerSyncHandler(() => {
  void runSync(getDb(), 'push');
});
