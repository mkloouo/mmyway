// Activity's fallback once local search runs out of cached rows: FF3's own search, and the one
// write that opening a hit needs (the transaction screen reads only the cache).
import type { FF3Client } from '../api/ff3/client';
import type { TransactionRead } from '../api/ff3/types';
import { createFF3Service } from '../api/ff3/service';
import { cachedTransactions } from '../db/schema';
import { cachedRowFromGroup } from '../sync/referenceData';
import type { OutboxDb } from '../sync/outbox';

export async function searchTransactions(
  client: FF3Client,
  query: string,
  maxPages = 2,
): Promise<TransactionRead[]> {
  return createFF3Service(client).transactions.search(query, maxPages);
}

/** Stores a search hit in the cache so the transaction screen can open it. False if it has no journal. */
export async function cacheRemoteResult(db: OutboxDb, group: TransactionRead): Promise<boolean> {
  const row = cachedRowFromGroup(group, new Date().toISOString());
  if (!row) return false;
  await db
    .insert(cachedTransactions)
    .values(row)
    .onConflictDoUpdate({ target: cachedTransactions.groupId, set: row });
  return true;
}
