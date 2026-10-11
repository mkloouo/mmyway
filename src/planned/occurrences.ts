// When a planned transaction happens, expanded from its repetitions. Pure, no db, no i18n.
//
// Firefly III hands over the next five dates per repetition (nine for daily) in
// `repetitions[].occurrences`, and no parameter raises that — `RecurringEnrichment` builds them
// with `getXOccurrencesSince(repetition, latest_date ?? first_date, now(), n)`, so they are
// future-only and already in the app's cache. Five is enough for one planned transaction's card;
// an agenda across all of them ("what is coming in November") needs the rules expanded here.
//
// `occurrences.test.ts` cross-checks the expansion against dates FF3's own enrichment produced for
// the same repetition, so the two cannot drift as `ndom` and `weekend` get exercised.
import { parseNdom, type Repetition, type WeekendRule } from './repetition';

const toUTC = (day: string): Date => new Date(`${day}T00:00:00Z`);
const iso = (date: Date): string => date.toISOString().slice(0, 10);
const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
const isoWeekdayOf = (date: Date): number => date.getUTCDay() || 7;

const addDays = (date: Date, days: number): Date => {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
};

/** The day of a month that `moment` means, with a 31st in a short month pulled back to its end. */
const dayOfMonth = (year: number, month: number, moment: number): Date =>
  new Date(Date.UTC(year, month, Math.min(Math.max(moment, 1), daysInMonth(year, month))));

/**
 * The nth given weekday of a month, counted from its first. FF3 counts whole weeks forward
 * (`startOfMonth`, then `addWeeks(n - 1)`), so a 5th the month does not have lands in the next
 * one — reproduced rather than clamped, so the expansion matches what FF3 books.
 */
const nthWeekday = (year: number, month: number, nth: number, weekday: number): Date => {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - isoWeekdayOf(first) + 7) % 7;
  return addDays(first, offset + (nth - 1) * 7);
};

/**
 * The first `count` dates a repetition falls on, on or after `from`. `skip` is anchored on `from`:
 * a monthly `skip: 2` from the 15th of January gives January, April, July.
 *
 * The weekend rule is **not** applied — `withWeekendRule` does that separately, so an expansion
 * can be compared with Firefly III's own `occurrences`, which are the raw dates too.
 */
export function expandRepetition(rep: Repetition, from: string, count: number): string[] {
  if (count <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return [];
  const every = Math.max(1, Math.trunc(rep.skip) + 1);
  const start = toUTC(from);
  if (Number.isNaN(start.getTime())) return [];
  const out: string[] = [];

  if (rep.type === 'daily') {
    for (let i = 0; i < count; i++) out.push(iso(addDays(start, i * every)));
    return out;
  }

  if (rep.type === 'weekly') {
    const weekday = Math.min(Math.max(Number(rep.moment) || 1, 1), 7);
    let cursor = addDays(start, (weekday - isoWeekdayOf(start) + 7) % 7);
    for (let i = 0; i < count; i++) {
      out.push(iso(cursor));
      cursor = addDays(cursor, 7 * every);
    }
    return out;
  }

  if (rep.type === 'yearly') {
    const month = Number(rep.moment.slice(5, 7)) - 1;
    const day = Number(rep.moment.slice(8, 10));
    if (!(month >= 0 && month <= 11) || !day) return [];
    let year = start.getUTCFullYear();
    if (dayOfMonth(year, month, day) < start) year += every;
    for (let i = 0; i < count; i++) out.push(iso(dayOfMonth(year + i * every, month, day)));
    return out;
  }

  // monthly and ndom share the month cursor and differ only in the day within the month.
  const dayIn =
    rep.type === 'ndom'
      ? (year: number, month: number) => {
          const { nth, weekday } = parseNdom(rep.moment);
          return nthWeekday(year, month, nth, weekday);
        }
      : (year: number, month: number) => dayOfMonth(year, month, Number(rep.moment) || 1);
  const year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  if (dayIn(year, month) < start) month += every;
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.UTC(year, month + i * every, 1));
    out.push(iso(dayIn(at.getUTCFullYear(), at.getUTCMonth())));
  }
  return out;
}

/**
 * The date an occurrence is really booked on under a weekend rule: 1 leaves it, 2 drops it (null),
 * 3 moves it back to the Friday, 4 forward to the Monday. Idempotent, so it is safe to apply to
 * dates Firefly III already handed over.
 *
 * ponytail: rule 2 is read as "this occurrence does not happen", which is what
 * RecurrenceRepetitionWeekend's own label says. The cron's two-day lookahead hints it may shift
 * rather than drop — question 5 in the plan's §5, to settle on the test instance; if it shifts,
 * this returns a date instead of null and nothing else changes.
 */
export function withWeekendRule(day: string, weekend: WeekendRule): string | null {
  const weekday = isoWeekdayOf(toUTC(day));
  if (weekday < 6 || weekend === 1) return day;
  if (weekend === 2) return null;
  if (weekend === 3) return iso(addDays(toUTC(day), weekday === 6 ? -1 : -2));
  return iso(addDays(toUTC(day), weekday === 6 ? 2 : 1));
}

interface UpcomingOptions {
  /** How many dates to return across all repetitions. */
  count?: number;
  /** Stop at this date, inclusive, however few that leaves. */
  until?: string | null;
  /** Dates the user cancelled one by one (the `mmyway-skip` marker, src/planned/notes.ts). */
  skipDays?: readonly string[];
}

/**
 * The next dates of a whole schedule: every repetition expanded, its weekend rule applied, skipped
 * dates dropped, then merged, deduplicated and sorted. What the occurrence list shows and what the
 * reminders are scheduled from.
 */
export function upcomingOccurrences(
  repetitions: readonly Repetition[],
  from: string,
  opts: UpcomingOptions = {},
): string[] {
  const count = opts.count ?? 5;
  if (count <= 0) return [];
  const skipped = new Set(opts.skipDays ?? []);
  const days = new Set<string>();
  for (const rep of repetitions) {
    // The weekend rule can drop dates, so more are expanded than are wanted.
    for (const raw of expandRepetition(rep, from, count * 2)) {
      if (opts.until && raw > opts.until) break;
      const day = withWeekendRule(raw, rep.weekend);
      if (!day || day < from || skipped.has(day)) continue;
      if (opts.until && day > opts.until) continue;
      days.add(day);
    }
  }
  return [...days].sort().slice(0, count);
}
