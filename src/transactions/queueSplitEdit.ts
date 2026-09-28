// Queues a split transaction's edit (every split, as they should be). A split edit still waiting
// in the queue is replaced rather than followed: its new splits have no journal id yet, so a
// second edit queued behind it would create them a second time once both were sent.
import { and, eq, inArray } from 'drizzle-orm';
import { outboxOperations } from '../db/schema';
import { enqueueOperation, type OutboxDb, type UpdateTransactionPayload } from '../sync/outbox';
import { readPayload } from '../sync/payloadJson';
import { generateId } from '../utils/id';

export async function queueSplitEdit(db: OutboxDb, payload: UpdateTransactionPayload & { splits: NonNullable<UpdateTransactionPayload['splits']> }): Promise<void> {
  const queued = await db.select().from(outboxOperations)
    .where(and(eq(outboxOperations.kind, 'update_transaction'), inArray(outboxOperations.status, ['pending', 'failed'])));
  let expectedUpdatedAt = payload.expectedUpdatedAt;
  const removed = new Set(payload.removedJournalIds ?? []);
  for (const op of queued) {
    const p = readPayload<UpdateTransactionPayload>(op.kind, op.payloadJson);
    // One whose update already landed is left to finish its split deletes.
    if (p.groupId !== payload.groupId || !p.splits || p.applied) continue;
    // Only while it hasn't started sending (the same claim rule as Undo).
    const gone = await db.delete(outboxOperations)
      .where(and(eq(outboxOperations.id, op.id), inArray(outboxOperations.status, ['pending', 'failed'])))
      .returning({ id: outboxOperations.id });
    if (gone.length > 0) {
      expectedUpdatedAt = p.expectedUpdatedAt;
      for (const id of p.removedJournalIds ?? []) removed.add(id);
    }
  }
  await enqueueOperation(db, { id: generateId(), kind: 'update_transaction', payload: { ...payload, expectedUpdatedAt, ...(removed.size ? { removedJournalIds: [...removed] } : {}) } });
}
