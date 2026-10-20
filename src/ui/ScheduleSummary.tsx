import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { SummaryCallout } from './kit';
import { endLabel, occurrenceLabel, scheduleLabel, weekdayName } from '../planned/labels';
import { expandRepetition, upcomingOccurrences, withWeekendRule } from '../planned/occurrences';
import type { PlannedGroup } from '../planned/model';
import type { EndCondition, Repetition } from '../planned/repetition';
import { localDay } from '../utils/day';

/** The ISO weekday (Mon = 1) of a `YYYY-MM-DD` day. */
export const isoWeekday = (day: string): number =>
  ((new Date(`${day}T12:00:00`).getDay() + 6) % 7) + 1;

/**
 * "(moved to Fri)": a day a weekend rule pushed here, not one the pattern lands on by itself.
 * Shared between ScheduleSheet and New Planned Payment.
 */
export function isMovedHere(day: string, repetitions: Repetition[], from: string): boolean {
  return repetitions.some((rep) =>
    expandRepetition(rep, from, 9).some(
      (raw) => raw !== day && withWeekendRule(raw, rep.weekend) === day,
    ),
  );
}

/**
 * Formats a day occurrence label, appending `(moved to <Day>)` if shifted by a weekend rule.
 */
export function movedOccurrenceLabel(day: string, repetitions: Repetition[], from: string): string {
  if (!isMovedHere(day, repetitions, from)) {
    return occurrenceLabel(day);
  }
  const dayName = weekdayName(isoWeekday(day), 'short');
  return `${occurrenceLabel(day)} (${i18n.t('planned.movedTo', { day: dayName })})`;
}

/**
 * SummaryCallout on top of the Schedule sheet (V4 board 22):
 * Displays "Every month on the 15th, until you change it"
 * and "Next: Oct 15 · Nov 13 (moved to Fri) · Dec 15".
 */
export function ScheduleSummary({
  repeats,
  repetitions,
  end,
  date,
  group,
}: {
  repeats: boolean;
  repetitions: Repetition[];
  end: EndCondition;
  date: string;
  group?: PlannedGroup | null;
}) {
  const { t: tr } = useTranslation();
  const today = localDay();
  const from = date > today ? date : today;
  const days = repeats
    ? upcomingOccurrences(repetitions, from, { count: 3 })
    : [date].filter((d) => d >= today);

  const titleParts = [
    scheduleLabel({ repeats, repetitions }, group),
    endLabel(end, repeats, { explicitForever: true }),
  ].filter(Boolean);
  const title = titleParts.join('');

  const nextDates =
    days.length > 0
      ? tr('planned.nextDates', {
          dates: days
            .map((d) => (repeats ? movedOccurrenceLabel(d, repetitions, from) : occurrenceLabel(d)))
            .join(' · '),
        })
      : undefined;

  return <SummaryCallout title={title} subtitle={nextDates} />;
}
