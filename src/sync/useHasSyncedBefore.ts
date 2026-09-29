// "Has anything ever synced" — a `limit(1)` probe instead of loading the whole cached table, so an
// empty list can tell "nothing yet, sign in and sync" from "synced, and there is nothing to show".
// undefined until the probe lands.
import { cachedTransactions } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';

export function useHasSyncedBefore(): boolean | undefined {
  const db = useDb();
  const { data } = useLiveQuery(
    db.select({ id: cachedTransactions.groupId }).from(cachedTransactions).limit(1),
  );
  return data === undefined ? undefined : data.length > 0;
}
