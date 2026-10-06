// Activity's second search: once the local list is exhausted, ask FF3 itself. A result found this
// way isn't written into the cache — local search stays a predictable, offline-first read — so it
// lives here as its own state until the user taps it.
import { useEffect, useState } from 'react';
import { getClient } from '../api/ff3/session';
import { useDb } from '../providers/DbProvider';
import { searchTransactions } from './remoteSearch';
import { mapRemoteResult, type RemoteResultRow } from './activityRows';
import type { ActivityTypeFilter } from './useTransactionPage';

export interface UseRemoteSearchOptions {
  type?: ActivityTypeFilter;
  accountId?: string | null;
}

export type RemoteSearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; rows: RemoteResultRow[] }
  | { status: 'error'; query: string }
  | { status: 'offline'; query: string };

export function buildRemoteSearchQuery(
  text: string,
  type: ActivityTypeFilter = 'all',
  accountId?: string | null,
): string {
  const parts: string[] = [];
  const trimmed = text.trim();
  if (trimmed) parts.push(trimmed);
  if (type !== 'all' && !trimmed.includes('type:')) {
    parts.push(`type:${type}`);
  }
  if (accountId && !trimmed.includes('account_id:')) {
    parts.push(`account_id:${accountId}`);
  }
  return parts.join(' ');
}

export function filterRemoteRows(
  rows: RemoteResultRow[],
  type: ActivityTypeFilter = 'all',
  accountId?: string | null,
): RemoteResultRow[] {
  return rows.filter((r) => {
    if (type !== 'all' && r.type !== type) return false;
    if (accountId && r.sourceId !== accountId && r.destinationId !== accountId) {
      const hasAccount = r.group.attributes.transactions.some((s) => {
        const extra = s as {
          source_id?: string | number | null;
          destination_id?: string | number | null;
        };
        return (
          (extra.source_id != null && String(extra.source_id) === accountId) ||
          (extra.destination_id != null && String(extra.destination_id) === accountId)
        );
      });
      if (!hasAccount) return false;
    }
    return true;
  });
}

/** `query` is '' while the screen has no reason to ask FF3 (still paging through the cache). */
export function useRemoteSearch(
  query: string,
  options: UseRemoteSearchOptions = {},
): RemoteSearchState {
  const db = useDb();
  const { type = 'all', accountId = null } = options;
  const trimmed = query.trim();
  const fullQuery = trimmed ? buildRemoteSearchQuery(trimmed, type, accountId) : '';
  const searchKey = `${trimmed}:${type}:${accountId ?? ''}`;

  // Only ever holds a *finished* fetch (never "loading") — "loading" is derived below from
  // whether this still matches `searchKey`, rather than set eagerly at the top of the effect.
  const [fetched, setFetched] = useState<
    | { key: string; query: string; status: 'done'; rows: RemoteResultRow[] }
    | { key: string; query: string; status: 'error' | 'offline' }
    | null
  >(null);

  useEffect(() => {
    if (!trimmed) return;
    let cancelled = false;
    void (async () => {
      const client = await getClient(db);
      if (!client) {
        if (!cancelled) setFetched({ status: 'offline', query: fullQuery, key: searchKey });
        return;
      }
      try {
        const found = await searchTransactions(client, fullQuery);
        if (cancelled) return;
        const allRows = found.map(mapRemoteResult).filter((r): r is RemoteResultRow => !!r);
        const rows = filterRemoteRows(allRows, type, accountId);
        setFetched({ status: 'done', query: fullQuery, key: searchKey, rows });
      } catch {
        if (!cancelled) setFetched({ status: 'error', query: fullQuery, key: searchKey });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, trimmed, fullQuery, searchKey, type, accountId]);

  // Once the query changes, the fetch above hasn't re-run yet — falling back to "loading" here
  // instead of resetting `fetched` avoids a stale result flashing under the new query.
  if (!trimmed) return { status: 'idle' };
  return fetched?.key === searchKey
    ? fetched.status === 'done'
      ? { status: 'done', query: fetched.query, rows: fetched.rows }
      : { status: fetched.status, query: fetched.query }
    : { status: 'loading', query: fullQuery };
}
