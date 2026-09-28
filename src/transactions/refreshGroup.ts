// Re-reads one transaction group from FF3 into the cache: a split transaction cached before every
// split was kept (splits_json) has to be read again before its splits can be shown and edited.
import type { FF3Client } from '../api/ff3/client';
import type { TransactionRead } from '../api/ff3/types';
import { cachedTransactions } from '../db/schema';
import { cachedRowFromGroup } from '../sync/referenceData';
import type { OutboxDb } from '../sync/outbox';

export async function refreshCachedGroup(
  db: OutboxDb,
  client: FF3Client,
  groupId: string,
): Promise<boolean> {
  const response = await client.request<{ data?: TransactionRead }>(`/v1/transactions/${groupId}`);
  const row = response?.data ? cachedRowFromGroup(response.data, new Date().toISOString()) : null;
  if (!row) return false;
  await db
    .insert(cachedTransactions)
    .values(row)
    .onConflictDoUpdate({ target: cachedTransactions.groupId, set: row });
  return true;
}
