// Activity's pinned rows: entries still queued for FF3, and ones just sent whose synced copy hasn't
// reached the cache yet ("landing"). Pure, no db.
//
// Both used to be decided against the *filtered* list. With an account selected that had no cached
// rows, "the cache last caught up" came out as never, so every entry the Inbox had ever sent (the
// last 30, including ones deleted in FF3 long ago) counted as still landing and was pinned under
// Today, whatever the account.
import { normkey } from '../lookup/normkey';
import type { ActivityTypeFilter } from './useTransactionPage';

interface SentItem {
  id: string;
  kind: string;
  ff3GroupId: string | null;
  updatedAt: string;
}

/**
 * Sent entries to show while their synced copy is on its way: not in the cache at all (not just
 * outside the current filter), sent after the cache last caught up, and not still queued. Anything
 * sent earlier is either cached already or gone from FF3. Unknown cache state (still loading, or a
 * cache that has never been filled) pins nothing.
 */
export function landingItems<T extends SentItem>(
  sent: readonly T[],
  cache: { groupIds: ReadonlySet<string>; caughtUpAt: string | null } | null,
  queuedInboxIds: ReadonlySet<string | null>,
): T[] {
  if (!cache?.caughtUpAt) return [];
  const caughtUpAt = cache.caughtUpAt;
  return sent.filter(
    (i) =>
      i.kind !== 'recurring_review' &&
      !!i.ff3GroupId &&
      !cache.groupIds.has(i.ff3GroupId) &&
      !queuedInboxIds.has(i.id) &&
      i.updatedAt > caughtUpAt,
  );
}

interface PinnableRow {
  type: 'withdrawal' | 'deposit' | 'transfer';
  sourceId: string | null;
  destinationId: string | null;
  description: string;
  sourceName: string | null;
  destinationName: string | null;
}

/** The same account, type and search filters the cached rows are read with (useTransactionPage). */
export function matchesActivityFilter(
  row: PinnableRow,
  filter: { type: ActivityTypeFilter; accountId: string | null; search: string },
): boolean {
  if (filter.type !== 'all' && row.type !== filter.type) return false;
  if (
    filter.accountId &&
    row.sourceId !== filter.accountId &&
    row.destinationId !== filter.accountId
  )
    return false;
  const key = normkey(filter.search.trim());
  if (key) {
    // What a cached row's search_key holds (searchKeyOf in src/sync/referenceData.ts).
    const text = normkey(
      [row.description, row.sourceName, row.destinationName].filter(Boolean).join(' '),
    );
    if (!text.includes(key)) return false;
  }
  return true;
}
