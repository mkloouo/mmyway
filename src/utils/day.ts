/**
 * A calendar day as YYYY-MM-DD in local time. `toISOString()` would shift it to UTC, which moves
 * an evening entry to the next day east of Greenwich and to the previous day west of it.
 */
export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The inverse of `localDay`: a YYYY-MM-DD key back to local midnight. */
export function dayDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * True when a balance was last read more than a day ago, so it can't be trusted for a count.
 * A balance with no read date counts as stale — we don't know when it was read.
 */
export function isBalanceStale(
  readAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!readAt) return true;
  return now - new Date(readAt).getTime() > STALE_MS;
}
