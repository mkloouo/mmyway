import i18n from '../i18n';
import type { ReminderWhen } from '../settings/appSettings';

/** The reminder timings a payment can be given. 'default' is the global setting, i.e. no override. */
export const REMIND_CHOICES: readonly (ReminderWhen | 'off')[] = [
  'day',
  'dayBefore',
  'fewDays',
  'week',
  'off',
];

/**
 * The reminder timing in words: "Day before · 9:00", "Default (On the day) · 9:00", or "Off".
 * Shared by the item editor and the wizard.
 */
export function remindLabel({
  override,
  when,
  time,
}: {
  override: ReminderWhen | 'off' | null;
  when: ReminderWhen;
  time?: string | null;
}): string {
  if (override === 'off') return i18n.t('planned.remind.off');
  const base = override
    ? i18n.t(`planned.remind.${override}`)
    : i18n.t('planned.remind.default', { when: i18n.t(`planned.remind.${when}`) });
  return time ? `${base} · ${time}` : base;
}
