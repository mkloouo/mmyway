// The budgeting period. Monthly only in v1 (ynab-bucket-budgeting-plan.md §5: FF3's budget limits
// take any start/end, but every screen and the carry computation doubles for a second length).
// Boundaries come from the phone's own calendar through `localDay`, never from UTC arithmetic:
// `new Date().toISOString().slice(0, 7)` puts a Warsaw evening on the 1st into the previous month.
import { localDay } from '../utils/day';

export interface Period {
  /** YYYY-MM-DD, the first day. Doubles as the period's key in `bucket_objects`. */
  start: string;
  /** YYYY-MM-DD, the last day — inclusive, as FF3's `start`/`end` query parameters are. */
  end: string;
}

/** The month `day` (YYYY-MM-DD, today by default) falls in. */
export function periodOf(day: string = localDay()): Period {
  const [year, month] = day.split('-').map(Number);
  const y = year ?? 1970;
  const m = month ?? 1;
  // Day 0 of the next month is the last day of this one, in local time.
  return { start: `${y}-${String(m).padStart(2, '0')}-01`, end: localDay(new Date(y, m, 0)) };
}

/** The month before `period` — "what you had left last month", for the auto-fill default. */
export function previousPeriod(period: Period): Period {
  const [year, month] = period.start.split('-').map(Number);
  const y = year ?? 1970;
  const m = month ?? 1;
  return periodOf(m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`);
}

/** Whether `day` (a YYYY-MM-DD, or a full ISO timestamp) falls inside the period. */
export function inPeriod(period: Period, day: string | null | undefined): boolean {
  if (!day) return false;
  const d = day.slice(0, 10);
  return d >= period.start && d <= period.end;
}
