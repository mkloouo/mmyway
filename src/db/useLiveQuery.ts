// Drop-in for drizzle-orm/expo-sqlite's useLiveQuery. drizzle's re-runs the query on every
// change event, and expo-sqlite fires one per changed row — so a sync upserting hundreds of
// accounts and months of transactions made every mounted screen re-read whole tables hundreds of
// times over, locking the JS thread (no button responded) for the length of the sync. Here change
// events are coalesced into at most one re-run per COALESCE_MS, and never two in flight at once.
import { addDatabaseChangeListener } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { getTableName, type Table } from 'drizzle-orm';
import type { AnySQLiteSelect } from 'drizzle-orm/sqlite-core';

const COALESCE_MS = 100;

export function useLiveQuery<T extends Pick<AnySQLiteSelect, '_' | 'then'>>(query: T, deps: unknown[] = []) {
  // undefined until the first read lands, so a screen can tell "still loading" from "empty".
  const [data, setData] = useState<Awaited<T> | undefined>(undefined);
  const [error, setError] = useState<Error>();
  const [updatedAt, setUpdatedAt] = useState<Date>();

  useEffect(() => {
    const tableName = getTableName((query as unknown as { config: { table: Table } }).config.table);
    let cancelled = false;
    let running = false;
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function run() {
      timer = undefined;
      running = true;
      dirty = false;
      Promise.resolve(query)
        .then((rows) => {
          if (cancelled) return;
          setData(rows as Awaited<T>);
          setUpdatedAt(new Date());
        }, (err: Error) => { if (!cancelled) setError(err); })
        .finally(() => {
          running = false;
          if (dirty && !cancelled) schedule();
        });
    }
    function schedule() {
      if (running) dirty = true;
      else if (!timer) timer = setTimeout(run, COALESCE_MS);
    }

    run();
    const listener = addDatabaseChangeListener((event) => { if (event.tableName === tableName) schedule(); });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      listener.remove();
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, updatedAt } as const;
}
