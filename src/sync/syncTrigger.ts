// "Something was just queued, send it soon" — so a confirm, an edit or a delete goes out within a
// couple of seconds instead of waiting for the next app resume or pull-to-refresh.
//
// Decoupled on purpose: the outbox (and everything that imports it, including every Jest test)
// only calls requestSync(); what actually runs a sync is registered once by the app
// (src/providers/queryClient.ts). With nothing registered — Jest — this is a no-op and schedules
// no timer, so tests never leave a pending handle behind.
// Longer than the Undo snackbar (src/ui/Snackbar.tsx, VISIBLE_MS = 5000): a confirm must stay
// undoable for as long as Undo is on screen, and sending it sooner would turn every tap on Undo
// into "Already sent".
const DEBOUNCE_MS = 6000;

let handler: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function registerSyncHandler(run: () => void): () => void {
  handler = run;
  return () => {
    if (handler === run) handler = null;
  };
}

/** Debounced: a burst (Confirm all, a cash-count sweep) becomes one sync. */
export function requestSync(): void {
  if (!handler) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    handler?.();
  }, DEBOUNCE_MS);
}

/** The React Query key useSync registers runSync under. */
export const SYNC_QUERY_KEY = ['sync'] as const;
