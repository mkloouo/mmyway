// Activity's second search: once the local list is exhausted, ask FF3 itself. A result found this
// way isn't written into the cache — local search stays a predictable, offline-first read — so it
// lives here as its own state until the user taps it.
import { useEffect, useState } from 'react';
import { getClient } from '../api/ff3/session';
import { useDb } from '../providers/DbProvider';
import { searchTransactions } from './remoteSearch';
import { mapRemoteResult, type RemoteResultRow } from './activityRows';

type RemoteSearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; rows: RemoteResultRow[] }
  | { status: 'error'; query: string }
  | { status: 'offline'; query: string };

/** `query` is '' while the screen has no reason to ask FF3 (still paging through the cache). */
export function useRemoteSearch(query: string): RemoteSearchState {
  const db = useDb();
  // Only ever holds a *finished* fetch (never "loading") — "loading" is derived below from
  // whether this still matches `query`, rather than set eagerly at the top of the effect.
  const [fetched, setFetched] = useState<
    | { query: string; status: 'done'; rows: RemoteResultRow[] }
    | { query: string; status: 'error' | 'offline' }
    | null
  >(null);

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    void (async () => {
      const client = await getClient(db);
      if (!client) {
        if (!cancelled) setFetched({ status: 'offline', query });
        return;
      }
      try {
        const found = await searchTransactions(client, query);
        if (cancelled) return;
        const rows = found.map(mapRemoteResult).filter((r): r is RemoteResultRow => !!r);
        setFetched({ status: 'done', query, rows });
      } catch {
        if (!cancelled) setFetched({ status: 'error', query });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, query]);

  // Once the query changes, the fetch above hasn't re-run yet — falling back to "loading" here
  // instead of resetting `fetched` avoids a stale result flashing under the new query.
  if (!query) return { status: 'idle' };
  return fetched?.query === query ? fetched : { status: 'loading', query };
}
