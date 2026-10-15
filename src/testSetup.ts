import { Query, Mutation, notifyManager } from '@tanstack/query-core';

// In Jest, TanStack React Query schedules a 5-minute setTimeout for garbage collection on every query
// and mutation (Query/Mutation.scheduleGc), and an asynchronous setTimeout(fn, 0) in notifyManager.
// In the Node test environment these active timers keep the event loop alive, causing Jest worker
// processes to hang and fail to exit gracefully ("A worker process has failed to exit gracefully...").
//
// Disabling background GC timeouts and running notifications synchronously in tests prevents leaks
// while keeping all React Query functionality and assertions fully working.
(Query.prototype as unknown as { scheduleGc: () => void }).scheduleGc = () => {};
(Mutation.prototype as unknown as { scheduleGc: () => void }).scheduleGc = () => {};
notifyManager.setScheduler((fn) => fn());
