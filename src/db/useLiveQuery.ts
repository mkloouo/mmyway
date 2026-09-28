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

function sameRow(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k])
  );
}

/**
 * A re-read returns fresh objects even when nothing about the rows changed, and every consumer
 * treats that new array as new data. A sync bumps `syncedAt` on rows no screen shows, so keeping
 * the previous array when the values match is what stops every list re-rendering on each sync.
 */
export function sameRows(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((row, i) => sameRow(row, b[i]));
}

/**
 * `deps` are this hook's only way to notice that the query changed — pass them whenever the query
 * has a `where` over something that can change, such as a route param. `enabled` is for a hidden
 * sheet: false keeps it from reading the table and subscribing while nobody can see the result.
 */
export function useLiveQuery<T extends Pick<AnySQLiteSelect, '_' | 'then'>>(
  query: T,
  deps: unknown[] = [],
  enabled = true,
) {
  // undefined until the first read lands, so a screen can tell "still loading" from "empty".
  const [data, setData] = useState<Awaited<T> | undefined>(undefined);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (!enabled) return;
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
        .then(
          (rows) => {
            if (cancelled) return;
            setData((prev) => (sameRows(prev, rows) ? prev : (rows as Awaited<T>)));
          },
          (err: Error) => {
            if (!cancelled) setError(err);
          },
        )
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
    const listener = addDatabaseChangeListener((event) => {
      if (event.tableName === tableName) schedule();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      listener.remove();
    };
  }, [...deps, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error } as const;
}
