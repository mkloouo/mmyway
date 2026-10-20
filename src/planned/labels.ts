// Display text for the Planned tab, in the app's language.
import i18n, { appLocale } from '../i18n';
import { currencySymbol } from '../money/format';
import { dayDate, localDay } from '../utils/day';
import type { PlannedFields, PlannedGroup } from './model';
import type { PlannedObject } from './objects';
import {
  parseNdom,
  type EndCondition,
  type Repetition,
  type RepetitionType,
  type WeekendRule,
} from './repetition';

/** The periods an FF3 subscription can repeat on, for the detailed view's one-line summary. */
const BILL_FREQUENCY_KEYS: Record<string, string> = {
  daily: 'planned.everyDay',
  weekly: 'planned.everyWeek',
  monthly: 'planned.everyMonth',
  quarterly: 'planned.everyQuarter',
  'half-year': 'planned.everyHalfYear',
  yearly: 'planned.everyYear',
};

/** Monday is ISO weekday 1, and 2024-01-01 was a Monday — so the names come from Intl, not i18n. */
export function weekdayName(weekday: number, width: 'long' | 'short' = 'long'): string {
  const date = new Date(Date.UTC(2024, 0, 1 + ((Math.trunc(weekday) - 1 + 7) % 7)));
  return date.toLocaleDateString(appLocale(), { weekday: width, timeZone: 'UTC' });
}

/** "5 March" from a `yearly` repetition's `YYYY-MM-DD` moment. */
function monthDayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? day
    : date.toLocaleDateString(appLocale(), { day: 'numeric', month: 'long' });
}

export const repetitionTypeName = (type: RepetitionType): string =>
  i18n.t(`planned.repType.${type}`);
export const weekendName = (weekend: WeekendRule): string => i18n.t(`planned.weekend.${weekend}`);
/** `ndom`'s n: "first" … "fifth". */
export const nthName = (nth: number): string => i18n.t(`planned.nth.${Math.trunc(nth)}`);

/** One repetition in words: "every 2 months on day 15, moved to the Friday". */
function repetitionLabel(rep: Repetition): string {
  const count = Math.max(1, Math.trunc(rep.skip) + 1);
  let text: string;
  switch (rep.type) {
    case 'daily':
      text = i18n.t('planned.rep.daily', { count });
      break;
    case 'weekly':
      text = i18n.t('planned.rep.weekly', { count, day: weekdayName(Number(rep.moment) || 1) });
      break;
    case 'monthly':
      text = i18n.t('planned.rep.monthly', { count, day: Number(rep.moment) || 1 });
      break;
    case 'ndom': {
      const { nth, weekday } = parseNdom(rep.moment);
      text = i18n.t('planned.rep.ndom', { count, nth: nthName(nth), day: weekdayName(weekday) });
      break;
    }
    case 'yearly':
      text = i18n.t('planned.rep.yearly', { count, date: monthDayLabel(rep.moment) });
      break;
  }
  return rep.weekend === 1 ? text : `${text}, ${weekendName(rep.weekend)}`;
}

/** How it stops; empty for "until I change it", unless explicitForever is true. */
export function endLabel(
  end: EndCondition,
  repeats = true,
  opts?: { explicitForever?: boolean },
): string {
  if (!repeats) return '';
  if (end.kind === 'times') return i18n.t('planned.endTimes', { count: Math.max(2, end.count) });
  if (end.kind === 'until') return i18n.t('planned.endUntil', { date: dayLabel(end.date) });
  if (opts?.explicitForever) return i18n.t('planned.endUntilChanged');
  return '';
}

/**
 * The whole schedule in words. Firefly III composes a description for every repetition it holds,
 * already localised to the instance's language, so a cached one is preferred over composing a
 * second description here — two of them would drift.
 */
export function scheduleLabel(
  f: Pick<PlannedFields, 'repeats' | 'repetitions'>,
  group?: PlannedGroup | null,
): string {
  if (!f.repeats || f.repetitions.length === 0) return i18n.t('planned.once');
  const described = (group?.recurrence?.attributes.repetitions ?? [])
    .map((r) => (typeof r.description === 'string' ? r.description : ''))
    .filter(Boolean);
  // Only when FF3 described the same set the app is showing: a queued edit has changed it.
  if (described.length === f.repetitions.length) return described.join(' · ');
  return f.repetitions.map(repetitionLabel).join(' · ');
}

export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A date as "Mon 5 Oct" — the occurrence list, where the weekday is the point. */
export function occurrenceLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Relative days for an occurrence: "today", "tomorrow", "in 3 days", "in 2 months".
 * Used by the occurrence sheet and planned item list (boards 20 and 21).
 */
export function relativeDayLabel(day: string, today: string = localDay()): string {
  const target = dayDate(day);
  const base = dayDate(today);
  if (Number.isNaN(target.getTime()) || Number.isNaN(base.getTime())) return '';
  const diffDays = Math.round((target.getTime() - base.getTime()) / 86_400_000);
  if (diffDays === 0) return i18n.t('time.today');
  if (diffDays === 1) return i18n.t('time.tomorrow');
  if (diffDays === -1) return i18n.t('time.yesterday');
  if (diffDays < -1) return i18n.t('time.daysAgoShort', { count: Math.abs(diffDays) });
  if (diffDays >= 30) {
    const months = Math.round(diffDays / 30);
    return i18n.t('time.inMonths', { count: Math.max(1, months) });
  }
  return i18n.t('time.inDays', { count: diffDays });
}

/** One line under an object's name in the detailed view. */
export function objectSummary(object: PlannedObject): string {
  if (object.kind === 'bill') {
    const a = object.attributes;
    const amount = a.amount_min === a.amount_max ? a.amount_max : `${a.amount_min}–${a.amount_max}`;
    return [
      `${amount ?? ''} ${currencySymbol(a.currency_code ?? '')}`.trim(),
      a.repeat_freq
        ? i18n.t(BILL_FREQUENCY_KEYS[a.repeat_freq] ?? 'planned.everyMonth', {
            count: (a.skip ?? 0) + 1,
          })
        : null,
      a.active === false ? i18n.t('planned.inactive') : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (object.kind === 'rule') {
    const a = object.attributes;
    return [
      a.rule_group_title ?? null,
      i18n.t('planned.triggerCount', { count: a.triggers?.length ?? 0 }),
      i18n.t('planned.actionCount', { count: a.actions?.length ?? 0 }),
      a.active === false ? i18n.t('planned.inactive') : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  const a = object.attributes;
  const tx = a.transactions?.[0];
  const next = a.repetitions?.[0]?.occurrences?.[0];
  return [
    tx ? `${tx.amount ?? ''} ${currencySymbol(tx.currency_code ?? '')}`.trim() : null,
    // FF3's own description, for every repetition it holds — not just the first.
    (a.repetitions ?? [])
      .map((r) => (typeof r.description === 'string' ? r.description : ''))
      .filter(Boolean)
      .join(' · ') || null,
    next ? i18n.t('planned.next', { date: dayLabel(next.slice(0, 10)) }) : null,
    a.active === false ? i18n.t('planned.inactive') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
