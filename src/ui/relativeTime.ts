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
  const time = at.toLocaleTimeString(appLocale(), { hour: '2-digit', minute: '2-digit' });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (at >= startOfToday) return i18n.t('time.todayAt', { time });
  if (at >= startOfYesterday) return i18n.t('time.yesterdayAt', { time });
  const day = at.toLocaleDateString(appLocale(), {
    day: 'numeric', month: 'short', ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return i18n.t('time.dayAt', { day, time });
}
