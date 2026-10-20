// The bucket_objects cache: FF3's budget limits, per-budget spending and piggy banks as rows, and
// back again. The same shape as src/planned/objects.ts — only the attributes this app reads are
// typed, the rest is kept as FF3 sent it.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { bucketObjects } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';
import { logLine } from '../utils/log';

export type BucketKind = 'budget_limit' | 'piggy' | 'budget_spent';

export interface BudgetLimitAttributes {
  /** The limit's own FF3 id — not in FF3's attributes, folded in here so a PUT can find it. */
  id: string;
  amount: string;
  /** Negative, as FF3 returns it: `amount + spent` is what is left. */
  spent?: string | null;
  currency_code?: string;
  start?: string;
  end?: string;
  period?: string | null;
  notes?: string | null;
  updated_at?: string;
  [key: string]: unknown;
}

/** A budget FF3 holds no limit for in this period: the spending is still real, and still shown. */
export interface BudgetSpentAttributes {
  spent: string;
  currency_code?: string;
  [key: string]: unknown;
}

export interface PiggyAttributes {
  name: string;
  current_amount: string;
  /** `'0'` means *no target* — FF3 switches both of its clamps off (plan §0). */
  target_amount?: string | null;
  target_date?: string | null;
  percentage?: number | null;
  currency_code?: string;
  object_group_title?: string | null;
  notes?: string | null;
  updated_at?: string;
  accounts?: { id?: string | number; name?: string; current_amount?: string }[];
  [key: string]: unknown;
}

export interface BucketObject<A = Record<string, unknown>> {
  key: string;
  kind: BucketKind;
  /** The budget's id for `budget_limit`/`budget_spent`, the piggy bank's own id otherwise. */
  ff3Id: string;
  periodStart: string | null;
  attributes: A;
}

type BucketRow = typeof bucketObjects.$inferSelect;

export function bucketKey(kind: BucketKind, ff3Id: string, periodStart?: string | null): string {
  return periodStart ? `${kind}:${ff3Id}:${periodStart}` : `${kind}:${ff3Id}`;
}

const BucketAttributesSchema = z.record(z.string(), z.unknown());

/** A cached row back as an object; null when its JSON is unreadable (skipped, not shown broken). */
export function readBucketRow(row: BucketRow): BucketObject | null {
  try {
    const parsed = BucketAttributesSchema.safeParse(JSON.parse(row.attributesJson));
    if (!parsed.success) {
      logLine('warn', `Malformed bucket object JSON for ${row.key}: ${parsed.error.message}`);
      return null;
    }
    return {
      key: row.key,
      kind: row.kind,
      ff3Id: row.ff3Id,
      periodStart: row.periodStart,
      attributes: parsed.data,
    };
  } catch {
    logLine('warn', `Unparseable bucket object JSON for ${row.key}`);
    return null;
  }
}

export function bucketRow(
  kind: BucketKind,
  ff3Id: string,
  periodStart: string | null,
  attributes: Record<string, unknown>,
  syncedAt: string,
): BucketRow {
  return {
    key: bucketKey(kind, ff3Id, periodStart),
    kind,
    ff3Id,
    periodStart: periodStart ?? null,
    attributesJson: JSON.stringify(attributes),
    syncedAt,
  };
}

/**
 * Stores one object as FF3 just answered it (after an assignment or a fund change), or removes it
 * (after a limit was deleted), so the Budget tab updates without waiting for the next sync.
 */
export async function storeBucketObject(
  db: OutboxDb,
  kind: BucketKind,
  ff3Id: string,
  periodStart: string | null,
  attributes: Record<string, unknown> | null,
): Promise<void> {
  const key = bucketKey(kind, ff3Id, periodStart);
  if (!attributes) {
    await db.delete(bucketObjects).where(eq(bucketObjects.key, key));
    return;
  }
  const row = bucketRow(kind, ff3Id, periodStart, attributes, new Date().toISOString());
  await db
    .insert(bucketObjects)
    .values(row)
    .onConflictDoUpdate({ target: bucketObjects.key, set: row });
}

/** The cached limit for one budget and period, if the last pull found one. */
export async function cachedLimit(
  db: OutboxDb,
  budgetId: string,
  periodStart: string,
): Promise<BudgetLimitAttributes | null> {
  const [row] = await db
    .select()
    .from(bucketObjects)
    .where(eq(bucketObjects.key, bucketKey('budget_limit', budgetId, periodStart)));
  const read = row ? readBucketRow(row) : null;
  return read ? (read.attributes as BudgetLimitAttributes) : null;
}
