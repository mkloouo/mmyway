// "Something was just queued, send it soon" — so a confirm, an edit or a delete goes out within a
// second or so instead of waiting for the next app resume or pull-to-refresh.
//
// Decoupled on purpose: the outbox (and everything that imports it, including every Jest test)
// only calls requestSync(); what actually runs a sync is registered once by the app
// (src/providers/queryClient.ts). With nothing registered — Jest — this is a no-op and schedules
// no timer, so tests never leave a pending handle behind.
/**
 * How long a write waits before it is pushed. A confirm waits out the Undo snackbar
 * (src/ui/Snackbar.tsx, VISIBLE_MS = 5000) — sending sooner would turn every tap on Undo into
 * "Already sent". Edits, deletes and account toggles have no undo, so they go out almost at once.
 */
export const SYNC_DELAY = { afterConfirm: 6000, afterWrite: 1000 } as const;

let handler: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let fireAt = 0;

export function registerSyncHandler(run: () => void): () => void {
  handler = run;
  return () => {
    if (handler === run) handler = null;
  };
}

/**
 * Debounced: a burst (Confirm all, a cash-count sweep) becomes one push. A shorter delay never
 * pulls a pending push forward — a quick delete right after a confirm must not send the confirm
 * inside its undo window.
 */
export function requestSync(delayMs: number = SYNC_DELAY.afterWrite): void {
  if (!handler) return;
  const at = Math.max(fireAt, Date.now() + delayMs);
  if (timer && at === fireAt) return;
  if (timer) clearTimeout(timer);
  fireAt = at;
  timer = setTimeout(() => {
    timer = null;
    fireAt = 0;
    handler?.();
  }, at - Date.now());
}

/**
 * How long a queue a sync couldn't send waits before the app tries again by itself: 5 s, then
 * longer, up to 5 minutes. Without it, a push that met a moment without network (a DNS lookup
 * failing just after a network switch) left everything queued until the next resume, reconnect
 * or pull-to-refresh, while Firefly III answered in the browser all along.
 */
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
let retries = 0;

/**
 * After a sync: `unsent` is whether anything is still waiting to be sent now, `nextAttemptAt` the
 * earliest time a change that failed may be retried. Asks for the sync that sends them; with
 * nothing waiting, the backoff starts over.
 */
export function retryUnsent(unsent: boolean, nextAttemptAt: number | null): void {
  if (unsent) {
    requestSync(RETRY_DELAYS_MS[Math.min(retries, RETRY_DELAYS_MS.length - 1)]);
    retries += 1;
    return;
  }
  retries = 0;
  if (nextAttemptAt !== null)
    requestSync(Math.max(nextAttemptAt - Date.now(), RETRY_DELAYS_MS[0]!));
}

/** The React Query key useSync registers runSync under. */
export const SYNC_QUERY_KEY = ['sync'] as const;
