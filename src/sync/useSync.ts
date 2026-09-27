import { useQuery } from '@tanstack/react-query';
import { useDb } from '../providers/DbProvider';
import { runSync } from './runSync';

const SYNC_QUERY_KEY = ['sync'];

export function useSync() {
  const db = useDb();
  const query = useQuery({
    queryKey: SYNC_QUERY_KEY,
    queryFn: () => runSync(db),
    staleTime: Infinity, // sync is triggered explicitly (open/resume/manual), never by staleness
  });
  return {
    status: query.isFetching ? 'syncing' as const : query.isError ? 'error' as const : 'idle' as const,
    summary: query.data ?? null,
    syncNow: query.refetch,
  };
}
