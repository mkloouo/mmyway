// One FF3 transaction group / split -> local shape mapper. Pure, unit-tested.
import { addDecimal } from '../api/ff3/decimal';
import type { TransactionRead, TransactionSplit } from '../api/ff3/types';
import type { cachedTransactions } from '../db/schema';
import { normkey } from '../lookup/normkey';
import type { EditableSplit } from '../splits/editSplits';
import type { SplitLine } from './activityRows';
import { splitsFromGroup, writeSplits, type CachedSplit } from './splitsJson';

export type CachedTransactionInsert = typeof cachedTransactions.$inferInsert;

export type TransactionType = 'withdrawal' | 'deposit' | 'transfer';

export function sumAmounts(splits: TransactionSplit[]): string {
  return splits.map((s) => s.amount).reduce((a, b) => addDecimal(a, b));
}

/**
 * A split group as one line: the splits' total when they share a currency (otherwise the first
 * split's amount, as there is no single total), under the group's title. Needs at least one split.
 */
export function groupHeadline(group: TransactionRead): { amount: string; description: string } {
  const splits = group.attributes.transactions;
  const journal = splits[0]!;
  const sameCurrency = splits.every((s) => s.currency_code === journal.currency_code);
  const amount = splits.length > 1 && sameCurrency ? sumAmounts(splits) : journal.amount;
  const groupTitle = (group.attributes as { group_title?: string | null }).group_title;
  const description = splits.length > 1 && groupTitle ? groupTitle : journal.description;
  return { amount, description };
}

/** What Activity search matches against: each field folded by normkey, kept apart so a query can't span two. */
export function searchKeyOf(parts: (string | null | undefined)[]): string {
  return parts.map((p) => normkey(p ?? '')).join('|');
}

/** Extract standard group type from first split of an FF3 transaction group. */
export function groupTypeOf(group: TransactionRead): TransactionType | undefined {
  const type = group.attributes.transactions[0]?.type;
  return type === 'withdrawal' || type === 'deposit' || type === 'transfer' ? type : undefined;
}

/** Maps a CachedSplit into an Activity list SplitLine. */
export function splitLineFromCached(split: CachedSplit): SplitLine {
  return {
    label: split.categoryName || split.description,
    amount: split.amount,
    categoryName: split.categoryName,
  };
}

/** Maps a CachedSplit into an EditableSplit for detail/split editors. */
export function editableSplitFromCached(split: CachedSplit): EditableSplit {
  return {
    journalId: split.journalId,
    amount: split.amount,
    description: split.description,
    sourceId: split.sourceId,
    sourceName: split.sourceName,
    destinationId: split.destinationId,
    destinationName: split.destinationName,
    categoryName: split.categoryName,
    budgetId: split.budgetId,
    notes: split.notes,
    tags: split.tags,
    internalReference: split.internalReference ?? null,
  };
}

/** One cached row per FF3 transaction group. Used by pullTransactions and replay conflict storage. */
export function cachedRowFromGroup(
  group: TransactionRead,
  syncedAt: string,
): CachedTransactionInsert | null {
  const splits = group.attributes.transactions;
  const journal = splits[0];
  if (!journal) return null;

  const extra = journal as {
    budget_name?: string | null;
    budget_id?: string | number | null;
    source_id?: string | number | null;
    destination_id?: string | number | null;
  };
  const { amount, description } = groupHeadline(group);
  const sourceName = journal.source_name ?? null;
  const destinationName = journal.destination_name ?? null;

  return {
    groupId: group.id,
    journalId: journal.transaction_journal_id,
    type: journal.type,
    date: journal.date,
    amount,
    currencyCode: journal.currency_code!,
    foreignAmount: splits.length > 1 ? null : (journal.foreign_amount ?? null),
    foreignCurrencyCode: splits.length > 1 ? null : (journal.foreign_currency_code ?? null),
    description,
    sourceName,
    destinationName,
    sourceId: extra.source_id != null ? String(extra.source_id) : null,
    destinationId: extra.destination_id != null ? String(extra.destination_id) : null,
    categoryName: journal.category_name ?? null,
    budgetName: extra.budget_name ?? null,
    budgetId: extra.budget_id != null ? String(extra.budget_id) : null,
    splitCount: splits.length,
    splitsJson: writeSplits(splitsFromGroup(group)),
    searchKey: searchKeyOf([
      description,
      ...splits.map((s) => s.description),
      sourceName,
      destinationName,
    ]),
    tagsJson: JSON.stringify(journal.tags ?? []),
    notes: journal.notes ?? null,
    updatedAt:
      (group.attributes as { updated_at?: string }).updated_at ?? journal.updated_at ?? syncedAt,
    syncedAt,
  };
}
