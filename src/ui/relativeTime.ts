// "2m ago" for the sync pill (design §6.1), a balance card's "as of" (§6.4) and a synced
// timestamp (§6.5). Pure, no db.
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'never';
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The Sync sheet's "Last synced": the pill's "2m ago" is too terse for a sheet that has room, and
 * the raw ISO timestamp it used to show was unreadable. "5 minutes ago", "today at 14:32",
 * "yesterday at 09:10", "3 Sep at 14:32".
 */
export function describeSyncTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'never';
  const at = new Date(iso);
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (at >= startOfToday) return `today at ${time}`;
  if (at >= startOfYesterday) return `yesterday at ${time}`;
  const day = at.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return `${day} at ${time}`;
}
