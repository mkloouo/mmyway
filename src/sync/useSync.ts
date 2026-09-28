import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDb } from '../providers/DbProvider';
import { readStoredCredentials } from '../api/ff3/auth';
import { getClient } from '../api/ff3/session';
import { pullOlderTransactions } from './referenceData';
import { runSync } from './runSync';
import { SYNC_QUERY_KEY } from './syncTrigger';
import { logLine } from '../utils/log';

const SIGNED_IN_QUERY_KEY = ['signedIn'];

export function useSync() {
  const db = useDb();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: SYNC_QUERY_KEY,
    queryFn: () => runSync(db),
    staleTime: Infinity, // sync is triggered explicitly (open/resume/manual), never by staleness
  });
  // cancelRefetch: false joins a sync already in flight. The default "cancels" it and starts
  // another, but runSync can't be aborted, so every extra trigger stacked a concurrent sync —
  // and a concurrent outbox replay.
  const { refetch } = query;
  const syncNow = useCallback(() => refetch({ cancelRefetch: false }), [refetch]);
  // Called by Settings after sign-in/sign-out — the only time the answer useSignedIn caches changes.
  const credentialsChanged = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: SIGNED_IN_QUERY_KEY });
    syncNow();
  }, [queryClient, syncNow]);
  return {
    status: query.isFetching
      ? ('syncing' as const)
      : query.isError
        ? ('error' as const)
        : ('idle' as const),
    summary: query.data ?? null,
    syncNow,
    credentialsChanged,
  };
}

// Activity's list only reads the local cache (useTransactionPage); this is the on-demand fetch
// that extends it further back once the user scrolls past what's cached. `exhausted` latches once
// a pull doesn't turn up anything older, so further scrolling stops asking the server. It only
// ever moves forward on its own — a pull-to-refresh (or anything else that wants to re-check) calls
// `reset` explicitly, since a manual sync can also bring in newer local rows without changing
// whether older history was already found to be exhausted.
export function useLoadOlderHistory() {
  const db = useDb();
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const inFlight = useRef(false);
  const loadOlder = useCallback(async () => {
    if (inFlight.current || exhausted) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const client = await getClient(db);
      const foundOlder = client
        ? await pullOlderTransactions(db, client, new Date().toISOString())
        : false;
      if (!foundOlder) setExhausted(true);
    } catch (err) {
      // Left un-exhausted on failure (network blip, host unreachable) so the next scroll retries
      // instead of the list silently pretending history ends here.
      logLine(
        'error',
        `loadOlderHistory failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [db, exhausted]);
  const reset = useCallback(() => setExhausted(false), []);
  return { loadOlder, loadingOlder: loading, exhausted, reset };
}

/** null until the first read. Read once, then only re-read via useSync().credentialsChanged. */
export function useSignedIn(): boolean | null {
  const { data } = useQuery({
    queryKey: SIGNED_IN_QUERY_KEY,
    queryFn: async () => !!(await readStoredCredentials()),
    staleTime: Infinity,
  });
  return data ?? null;
}

/**
 * The spinner a list shows for a pull-to-refresh — only for a sync the user pulled for, not for
 * every sync (the status pill already says "Syncing…"). `before` runs first on each pull
 * (Activity uses it to re-check older history).
 */
export function usePullToRefresh(before?: () => void) {
  const { syncNow } = useSync();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    before?.();
    setRefreshing(true);
    void syncNow().finally(() => setRefreshing(false));
  }, [syncNow, before]);
  return { refreshing, onRefresh };
}
