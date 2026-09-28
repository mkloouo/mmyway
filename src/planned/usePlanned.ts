// The Planned tab's data: the cached FF3 objects and the simple view's items, live.
import { inArray } from 'drizzle-orm';
import { useMemo } from 'react';
import { outboxOperations, plannedObjects } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';
import { plannedItems, type PlannedItem } from './items';
import { readPlannedRow, type PlannedObject } from './objects';

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function usePlanned(): { objects: PlannedObject[]; items: PlannedItem[]; loaded: boolean } {
  const db = useDb();
  const { data: rows } = useLiveQuery(db.select().from(plannedObjects));
  const { data: ops } = useLiveQuery(
    db
      .select()
      .from(outboxOperations)
      .where(inArray(outboxOperations.kind, ['save_planned', 'delete_planned'])),
  );
  return useMemo(() => {
    const objects = (rows ?? []).map(readPlannedRow).filter((o): o is PlannedObject => !!o);
    return {
      objects,
      items: plannedItems(objects, ops ?? [], todayIso()),
      loaded: rows !== undefined,
    };
  }, [rows, ops]);
}
