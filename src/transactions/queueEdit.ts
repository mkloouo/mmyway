// The transaction screen's Save and Delete for a synced transaction: queued like any other write,
// each carrying the updated_at it was made against so a change in FF3 meanwhile is a conflict.
import { cachedTransactions } from '../db/schema';
import { enqueueOperation, type OutboxDb, type UpdateTransactionPayload } from '../sync/outbox';
import { generateId } from '../utils/id';

type CachedRow = Pick<typeof cachedTransactions.$inferSelect, 'groupId' | 'journalId' | 'updatedAt'>;

export async function queueTransactionEdit(db: OutboxDb, row: CachedRow, changes: UpdateTransactionPayload['changes']): Promise<void> {
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'update_transaction',
    payload: { groupId: row.groupId, transactionJournalId: row.journalId, expectedUpdatedAt: row.updatedAt, changes },
  });
}

export async function queueTransactionDelete(db: OutboxDb, row: CachedRow): Promise<void> {
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'delete_transaction',
    payload: { groupId: row.groupId, expectedUpdatedAt: row.updatedAt },
  });
}
