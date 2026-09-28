// cached_transactions.splits_json: every split of a transaction group, so the detail screen can
// show and edit split 2 of 3, not just the first one. Written on each pull (cachedRowFromGroup)
// and validated when read back, like draft_json and payload_json.
import { z } from 'zod';
import type { TransactionRead, TransactionSplit } from '../api/ff3/types';

const nullableText = z.string().nullable();

const CachedSplitSchema = z.object({
  journalId: z.string(),
  amount: z.string(),
  description: z.string(),
  sourceId: nullableText,
  sourceName: nullableText,
  destinationId: nullableText,
  destinationName: nullableText,
  categoryName: nullableText,
  budgetId: nullableText,
  budgetName: nullableText,
  notes: nullableText,
  tags: z.array(z.string()),
  foreignAmount: nullableText,
  foreignCurrencyCode: nullableText,
});

export type CachedSplit = z.infer<typeof CachedSplitSchema>;

/** Null when the column is empty (cached before it existed) or unreadable: the caller re-reads the group. */
export function readSplits(json: string | null | undefined): CachedSplit[] | null {
  if (!json) return null;
  try {
    const result = z.array(CachedSplitSchema).safeParse(JSON.parse(json));
    return result.success && result.data.length > 0 ? result.data : null;
  } catch {
    return null;
  }
}

export function writeSplits(splits: CachedSplit[]): string {
  return JSON.stringify(splits);
}

function idOf(value: unknown): string | null {
  return value != null && value !== '' ? String(value) : null;
}

/** FF3 read responses carry these; TransactionSplit (pinned) doesn't declare them all. */
type ReadSplit = TransactionSplit & {
  budget_name?: string | null;
  budget_id?: string | number | null;
  source_id?: string | number | null;
  destination_id?: string | number | null;
};

export function splitsFromGroup(group: TransactionRead): CachedSplit[] {
  return group.attributes.transactions.map((raw) => {
    const s = raw as ReadSplit;
    return {
      journalId: String(s.transaction_journal_id),
      amount: s.amount,
      description: s.description ?? '',
      sourceId: idOf(s.source_id),
      sourceName: s.source_name ?? null,
      destinationId: idOf(s.destination_id),
      destinationName: s.destination_name ?? null,
      categoryName: s.category_name ?? null,
      budgetId: idOf(s.budget_id),
      budgetName: s.budget_name ?? null,
      notes: s.notes ?? null,
      tags: s.tags ?? [],
      foreignAmount: s.foreign_amount ?? null,
      foreignCurrencyCode: s.foreign_currency_code ?? null,
    };
  });
}
