// What is left in one envelope, for Capture to show beside the budget it has chosen.
//
// Deliberately NOT useBucket(): Capture is the most-used screen in the app, and useBucket reads
// four tables to build every envelope, fund and bill. This reads the two rows for one budget and
// the open period, and nothing else — one query, no network, no writes.
import { inArray } from 'drizzle-orm';
import { useMemo } from 'react';
import { bucketObjects } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';
import { localDay } from '../utils/day';
import {
  bucketKey,
  readBucketRow,
  type BudgetLimitAttributes,
  type BudgetSpentAttributes,
} from './objects';
import { envelopeAmounts } from './envelopes';
import { periodOf } from './period';

/**
 * `{ available }` for the chosen budget this period, or null when nothing is chosen and when the
 * cache has nothing for it (no limit and no spending — there is no number worth showing then).
 */
export function useEnvelopeRemaining(budgetId: string | null | undefined): string | null {
  const db = useDb();
  const period = periodOf(localDay());
  const keys = budgetId
    ? [
        bucketKey('budget_limit', budgetId, period.start),
        bucketKey('budget_spent', budgetId, period.start),
      ]
    : [];
  const { data: rows } = useLiveQuery(
    db
      .select()
      .from(bucketObjects)
      .where(inArray(bucketObjects.key, keys.length > 0 ? keys : [''])),
    [budgetId, period.start],
    !!budgetId,
  );

  return useMemo(() => {
    if (!budgetId) return null;
    const objects = (rows ?? []).map(readBucketRow);
    const limit = objects.find((o) => o?.kind === 'budget_limit')?.attributes as
      BudgetLimitAttributes | undefined;
    const unbudgeted = objects.find((o) => o?.kind === 'budget_spent')?.attributes as
      BudgetSpentAttributes | undefined;
    // Neither a limit nor any spending: there is no number worth putting on the screen.
    if (!limit && !unbudgeted) return null;
    return envelopeAmounts(limit, unbudgeted).available;
  }, [rows, budgetId]);
}

/**
 * Returns a map of `budgetId -> available amount` for all budgets with limits or spending
 * in the current period, so pickers can display each budget's remaining balance.
 */
export function useAllEnvelopesRemaining(): Map<string, string> {
  const db = useDb();
  const period = periodOf(localDay());
  const { data: rows } = useLiveQuery(
    db
      .select()
      .from(bucketObjects)
      .where(inArray(bucketObjects.kind, ['budget_limit', 'budget_spent'])),
    [period.start],
  );

  return useMemo(() => {
    const result = new Map<string, string>();
    if (!rows) return result;
    const objects = rows
      .filter((r) => r.periodStart === period.start)
      .map(readBucketRow)
      .filter(Boolean);
    const byBudget = new Map<
      string,
      { limit?: BudgetLimitAttributes; spent?: BudgetSpentAttributes }
    >();
    for (const obj of objects) {
      if (!obj || !obj.ff3Id) continue;
      const cur = byBudget.get(obj.ff3Id) ?? {};
      if (obj.kind === 'budget_limit') cur.limit = obj.attributes as BudgetLimitAttributes;
      if (obj.kind === 'budget_spent') cur.spent = obj.attributes as BudgetSpentAttributes;
      byBudget.set(obj.ff3Id, cur);
    }
    for (const [id, { limit, spent }] of byBudget) {
      if (limit || spent) {
        result.set(id, envelopeAmounts(limit, spent).available);
      }
    }
    return result;
  }, [rows, period.start]);
}
