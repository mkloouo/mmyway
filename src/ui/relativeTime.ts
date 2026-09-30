// "2m ago" for the sync pill (design §6.1), a balance card's "as of" (§6.4) and a synced
// timestamp (§6.5). Pure, no db.
import i18n, { appLocale } from '../i18n';

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return i18n.t('time.never');
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return i18n.t('time.justNow');
  if (minutes < 60) return i18n.t('time.minutesAgoShort', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t('time.hoursAgoShort', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return i18n.t('time.daysAgoShort', { count: days });
  return new Date(iso).toLocaleDateString(appLocale());
}

/**
 * The Sync sheet's "Last synced": the pill's "2m ago" is too terse for a sheet that has room, and
 * the raw ISO timestamp it used to show was unreadable. "5 minutes ago", "today at 14:32",
 * "yesterday at 09:10", "3 Sep at 14:32".
 */
export function describeSyncTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return i18n.t('time.never');
  const at = new Date(iso);
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return i18n.t('time.justNow');
  if (minutes < 60) return i18n.t('time.minutesAgo', { count: minutes });
  return dayAndTime(at, now);
}

/**
 * An Inbox card's date: "14:05" for today, then as the Sync sheet says it ("yesterday at 09:10",
 * "3 Sep at 14:32"). A time alone read as today on a draft from last week.
 */
export function entryTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return at >= startOfToday && at < startOfTomorrow
    ? at.toLocaleTimeString(appLocale(), { hour: '2-digit', minute: '2-digit' })
    : dayAndTime(at, now);
}

function dayAndTime(at: Date, now: Date): string {
  const time = at.toLocaleTimeString(appLocale(), { hour: '2-digit', minute: '2-digit' });
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  // A draft can be dated ahead: only today is "today".
  if (at >= startOfToday && at < startOfTomorrow) return i18n.t('time.todayAt', { time });
  if (at >= startOfYesterday && at < startOfToday) return i18n.t('time.yesterdayAt', { time });
  const day = at.toLocaleDateString(appLocale(), {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return i18n.t('time.dayAt', { day, time });
}
