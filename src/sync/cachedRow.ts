// Cached transaction rows and Activity search key generation. Pure mapping + backfill.
import { eq, isNull, sql } from 'drizzle-orm';
import type { TransactionRead } from '../api/ff3/types';
import { cachedTransactions } from '../db/schema';
import type { OutboxDb } from './outbox';
import { groupHeadline } from '../transactions/activityRows';
import { normkey } from '../lookup/normkey';
import { splitsFromGroup, writeSplits } from '../transactions/splitsJson';

export type CachedTransactionInsert = typeof cachedTransactions.$inferInsert;

/** What Activity search matches against: each field folded by normkey, kept apart so a query can't span two. */
export function searchKeyOf(parts: (string | null | undefined)[]): string {
  return parts.map((p) => normkey(p ?? '')).join('|');
}

/** One cached row per FF3 transaction group. Also used by the outbox to store the server's copy on a conflict. */
export function cachedRowFromGroup(
  group: TransactionRead,
  syncedAt: string,
): CachedTransactionInsert | null {
  // One row per group (cachedTransactions is keyed by groupId). A split transaction is shown as
  // one entry: the splits' total (when they share a currency) under the group's title, with the
  // first split's accounts and category. Every split is kept in splitsJson for the detail screen.
  const splits = group.attributes.transactions;
  const journal = splits[0];
  if (!journal) return null;
  // FF3 read responses carry these; TransactionSplit (pinned) doesn't declare them all.
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
    // Read responses always populate currency_code; TransactionSplit only marks it optional
    // because the same type also covers write payloads, which can omit it.
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
    // FF3 puts updated_at on the group's attributes, not on each split — journal.updated_at
    // is undefined against real API responses despite what TransactionSplit's type claims
    // (confirmed on a real device sync: NOT NULL constraint failed: cached_transactions.updated_at).
    updatedAt:
      (group.attributes as { updated_at?: string }).updated_at ?? journal.updated_at ?? syncedAt,
    syncedAt,
  };
}

/**
 * Rows cached before the search key and account ids existed (migration 0007) get them here, once:
 * the key from their own text, the ids by account name — the best a row without them can do.
 */
export async function backfillCachedTransactions(db: OutboxDb): Promise<void> {
  const rows = await db
    .select({
      groupId: cachedTransactions.groupId,
      description: cachedTransactions.description,
      sourceName: cachedTransactions.sourceName,
      destinationName: cachedTransactions.destinationName,
    })
    .from(cachedTransactions)
    .where(isNull(cachedTransactions.searchKey));
  if (rows.length === 0) return;
  db.transaction((tx) => {
    for (const row of rows) {
      tx.update(cachedTransactions)
        .set({ searchKey: searchKeyOf([row.description, row.sourceName, row.destinationName]) })
        .where(eq(cachedTransactions.groupId, row.groupId))
        .run();
    }
  });
  await db
    .update(cachedTransactions)
    .set({
      sourceId: sql`(select id from reference_accounts where reference_accounts.name = cached_transactions.source_name limit 1)`,
    })
    .where(isNull(cachedTransactions.sourceId));
  await db
    .update(cachedTransactions)
    .set({
      destinationId: sql`(select id from reference_accounts where reference_accounts.name = cached_transactions.destination_name limit 1)`,
    })
    .where(isNull(cachedTransactions.destinationId));
}
