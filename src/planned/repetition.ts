// One repetition of a planned transaction's schedule — the whole of what a Firefly III recurrence
// repetition can say, sent as FF3 holds it. Pure, no db, no i18n.
//
// The app used to keep five presets and `repetitions[0]`, which could not say "the second Tuesday",
// "skip it on a weekend" or "the 1st and the 15th", silently rewrote a `daily` or `ndom` recurrence
// as monthly, and destroyed every repetition after the first on any schedule edit.
//
// `moment`'s shape is decided by `type`; the per-type rules are FF3's
// app/Validation/RecurrenceValidation.php (validateDaily wants it *empty*, validateYearly parses it
// as `Y-m-d`), and its budget is 10 characters, which `Y-m-d` fills exactly.
import type { RecurrenceRepetition } from './objects';

export type RepetitionType = 'daily' | 'weekly' | 'ndom' | 'monthly' | 'yearly';
export const REPETITION_TYPES: readonly RepetitionType[] = [
  'daily',
  'weekly',
  'ndom',
  'monthly',
  'yearly',
];

/** FF3's weekend rule: 1 do nothing · 2 skip · 3 move to Friday · 4 move to Monday. */
export type WeekendRule = 1 | 2 | 3 | 4;
export const WEEKEND_RULES: readonly WeekendRule[] = [1, 2, 3, 4];

export interface Repetition {
  /** FF3's id when it has one; absent on a repetition added here. */
  id?: string;
  type: RepetitionType;
  /** '' daily · '1'–'7' weekly (ISO) · '1'–'31' monthly · 'n,d' ndom (n 1–5, d 1–7) · 'Y-m-d' yearly */
  moment: string;
  /** Every how many periods minus one: FF3's own `skip`, sent as it is. */
  skip: number;
  weekend: WeekendRule;
}

/** FF3 takes exactly one of `repeat_until` and `nr_of_repetitions` — "Not both." */
export type EndCondition =
  { kind: 'forever' } | { kind: 'until'; date: string } | { kind: 'times'; count: number };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.trunc(Number.isFinite(value) ? value : min)));

const isoWeekday = (date: string): number => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

/** Which week of its month a date falls in, 1–5: `ndom`'s "n". */
const nthOfMonth = (date: string): number =>
  clamp(Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1, 1, 5);

/** The `moment` a type takes for a date: what a row starts from when its type is switched. */
export function momentFor(type: RepetitionType, date: string): string {
  switch (type) {
    case 'daily':
      return '';
    case 'weekly':
      return String(isoWeekday(date));
    case 'monthly':
      return String(Number(date.slice(8, 10)));
    case 'ndom':
      return `${nthOfMonth(date)},${isoWeekday(date)}`;
    case 'yearly':
      return date;
  }
}

/** `"2,1"` as its parts; anything unreadable as the first Monday. */
export function parseNdom(moment: string): { nth: number; weekday: number } {
  const [nth, weekday] = moment.split(',').map(Number);
  return { nth: clamp(nth!, 1, 5), weekday: clamp(weekday!, 1, 7) };
}

export const ndomMoment = (nth: number, weekday: number): string =>
  `${clamp(nth, 1, 5)},${clamp(weekday, 1, 7)}`;

/** The repetition a new planned transaction starts from: once a month, on its date's day. */
export function defaultRepetition(date: string): Repetition {
  return { type: 'monthly', moment: momentFor('monthly', date), skip: 0, weekend: 1 };
}

/** FF3's repetition as the app's. An unknown type is kept as monthly rather than guessed at. */
export function repetitionFromFF3(rep: RecurrenceRepetition): Repetition {
  const type = REPETITION_TYPES.find((t) => t === rep.type) ?? 'monthly';
  return {
    ...(rep.id != null ? { id: String(rep.id) } : {}),
    type,
    moment: String(rep.moment ?? ''),
    skip: clamp(rep.skip ?? 0, 0, 31),
    weekend: WEEKEND_RULES.find((w) => w === rep.weekend) ?? 1,
  };
}

/**
 * The app's repetition as FF3's body — without the id, deliberately.
 * `RecurrenceUpdateService::updateRepetitions` only tries to *match* submitted repetitions to
 * stored ones when the stored count is greater than one and the submitted count equals it, and
 * `matchRepetition` queries on every field, so a changed value matches nothing and the update
 * throws. replay.ts routes that case through an intermediate single-repetition PUT so the counts
 * always differ, which means FF3 deletes and recreates the rows and any id sent is meaningless.
 */
export function repetitionToFF3(rep: Repetition): Record<string, unknown> {
  return {
    type: rep.type,
    moment: rep.moment,
    skip: clamp(rep.skip, 0, 31),
    weekend: rep.weekend,
  };
}

/** Everything that makes a repetition what it is, the id aside: it is FF3's, not the user's. */
const sortKey = (rep: Repetition) => `${rep.type}|${rep.moment}|${rep.skip}|${rep.weekend}`;

/** Order-insensitive: "the 1st and the 15th" is the same schedule whichever row comes first. */
export function sameRepetitions(a: readonly Repetition[], b: readonly Repetition[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].map(sortKey).sort();
  const right = [...b].map(sortKey).sort();
  return left.every((key, i) => key === right[i]);
}

export function sameEnd(a: EndCondition, b: EndCondition): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'until' && b.kind === 'until') return a.date === b.date;
  if (a.kind === 'times' && b.kind === 'times') return a.count === b.count;
  return true;
}

/** A repetition FF3's RecurrenceValidation would refuse, as a reason, or null. */
export function repetitionProblem(rep: Repetition): 'moment' | 'skip' | null {
  if (rep.skip < 0 || rep.skip > 31) return 'skip';
  const number = Number(rep.moment);
  switch (rep.type) {
    // validateDaily: the moment must be empty.
    case 'daily':
      return rep.moment === '' ? null : 'moment';
    case 'weekly':
      return Number.isInteger(number) && number >= 1 && number <= 7 ? null : 'moment';
    case 'monthly':
      return Number.isInteger(number) && number >= 1 && number <= 31 ? null : 'moment';
    case 'ndom': {
      const { nth, weekday } = parseNdom(rep.moment);
      return rep.moment === `${nth},${weekday}` ? null : 'moment';
    }
    case 'yearly':
      return /^\d{4}-\d{2}-\d{2}$/.test(rep.moment) &&
        !Number.isNaN(new Date(`${rep.moment}T00:00:00Z`).getTime())
        ? null
        : 'moment';
  }
}

/** Roughly how many days a repetition leaves between occurrences: which of a set is the frequent one. */
const periodDays: Record<RepetitionType, number> = {
  daily: 1,
  weekly: 7,
  ndom: 30,
  monthly: 30,
  yearly: 365,
};

/**
 * The closest `repeat_freq` + `skip` a subscription can hold for these repetitions. Lossy on
 * purpose: FF3 bills repeat on `weekly,monthly,quarterly,half-year,yearly` only — no daily, no
 * ndom, no second repetition (`Bill/UpdateRequest.php`) — and the bill is there for `link_to_bill`
 * matching and for `paid_dates`/`pay_dates`, not for booking. The recurring transaction books, and
 * it carries the exact schedule.
 *
 * `monthly` + `skip` stays `monthly` + `skip` rather than being relabelled `quarterly`: that
 * relabelling is what never round-tripped.
 */
export function billSchedule(reps: readonly Repetition[]): { repeat_freq: string; skip: number } {
  const most = [...reps].sort(
    (a, b) => periodDays[a.type] * (a.skip + 1) - periodDays[b.type] * (b.skip + 1),
  )[0];
  if (!most) return { repeat_freq: 'monthly', skip: 0 };
  switch (most.type) {
    case 'daily':
      return { repeat_freq: 'weekly', skip: 0 };
    case 'weekly':
      return { repeat_freq: 'weekly', skip: most.skip };
    case 'ndom':
    case 'monthly':
      return { repeat_freq: 'monthly', skip: most.skip };
    case 'yearly':
      return { repeat_freq: 'yearly', skip: most.skip };
  }
}
