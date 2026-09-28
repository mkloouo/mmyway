// Display text for the Planned tab, in the app's language.
import i18n, { appLocale } from '../i18n';
import type { Frequency, PlannedFields } from './model';
import type { PlannedObject } from './objects';

const FREQUENCY_KEYS: Record<Frequency, string> = {
  weekly: 'planned.everyWeek',
  monthly: 'planned.everyMonth',
  quarterly: 'planned.everyQuarter',
  'half-year': 'planned.everyHalfYear',
  yearly: 'planned.everyYear',
};

export function frequencyName(frequency: Frequency): string {
  return i18n.t(`planned.frequency.${frequency}`);
}

export function scheduleLabel(f: Pick<PlannedFields, 'repeats' | 'frequency' | 'every'>): string {
  if (!f.repeats) return i18n.t('planned.once');
  return i18n.t(FREQUENCY_KEYS[f.frequency], { count: f.every });
}

export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** One line under an object's name in the detailed view. */
export function objectSummary(object: PlannedObject): string {
  if (object.kind === 'bill') {
    const a = object.attributes;
    const amount = a.amount_min === a.amount_max ? a.amount_max : `${a.amount_min}–${a.amount_max}`;
    return [
      `${amount ?? ''} ${a.currency_code ?? ''}`.trim(),
      a.repeat_freq
        ? i18n.t(FREQUENCY_KEYS[a.repeat_freq as Frequency] ?? 'planned.everyMonth', {
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
    tx ? `${tx.amount ?? ''} ${tx.currency_code ?? ''}`.trim() : null,
    (a.repetitions?.[0]?.description as string | undefined) ?? null,
    next ? i18n.t('planned.next', { date: dayLabel(next.slice(0, 10)) }) : null,
    a.active === false ? i18n.t('planned.inactive') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
