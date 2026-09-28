// Activity's fallback once local search runs out of cached rows: FF3's own search, and the one
// write that opening a hit needs (the transaction screen reads only the cache).
import type { FF3Client } from '../api/ff3/client';
import type { TransactionRead } from '../api/ff3/types';
import { cachedTransactions } from '../db/schema';
import { cachedRowFromGroup } from '../sync/referenceData';
import type { OutboxDb } from '../sync/outbox';

export async function searchTransactions(client: FF3Client, query: string): Promise<TransactionRead[]> {
  const response = await client.request<{ data: TransactionRead[] }>(
    `/v1/search/transactions?query=${encodeURIComponent(query)}&limit=50&page=1`,
  );
  return response.data;
}

/** Stores a search hit in the cache so the transaction screen can open it. False if it has no journal. */
export async function cacheRemoteResult(db: OutboxDb, group: TransactionRead): Promise<boolean> {
  const row = cachedRowFromGroup(group, new Date().toISOString());
  if (!row) return false;
  await db.insert(cachedTransactions).values(row).onConflictDoUpdate({ target: cachedTransactions.groupId, set: row });
  return true;
}
