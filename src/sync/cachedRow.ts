// Cached transaction rows and Activity search key generation. Pure mapping + backfill.
import { eq, isNull, sql } from 'drizzle-orm';
import { cachedTransactions } from '../db/schema';
import type { OutboxDb } from './outbox';
import {
  cachedRowFromGroup,
  searchKeyOf,
  type CachedTransactionInsert,
} from '../transactions/fromFf3';

export type { CachedTransactionInsert };
export { cachedRowFromGroup, searchKeyOf };

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
