// Queues the Planned tab's saves and deletes. Like account edits they go through the outbox, so
// they work offline and reach FF3 in order with everything else.
import { and, eq, inArray } from 'drizzle-orm';
import { outboxOperations } from '../db/schema';
import { enqueueOperation, type OutboxDb } from '../sync/outbox';
import { readPayload, writePayload } from '../sync/payloadJson';
import { requestSync } from '../sync/syncTrigger';
import { generateId } from '../utils/id';
import type { PlannedItem } from './items';
import type { PlannedFields } from './model';
import type { SavePlannedPayload } from './replay';

/** The queued save of a planned transaction that isn't in FF3 yet, while it can still be changed. */
async function queuedSaveFor(db: OutboxDb, key: string) {
  const ops = await db.select().from(outboxOperations)
    .where(and(eq(outboxOperations.kind, 'save_planned'), inArray(outboxOperations.status, ['pending', 'failed'])));
  return ops.find((op) => readPayload<SavePlannedPayload>(op.kind, op.payloadJson).key === key) ?? null;
}

export async function savePlanned(db: OutboxDb, item: PlannedItem | null, fields: PlannedFields): Promise<void> {
  if (item && !item.group) {
    // Still only in the queue: change what will be sent rather than queueing a second create.
    const op = await queuedSaveFor(db, item.key);
    if (op) {
      const payload = readPayload<SavePlannedPayload>(op.kind, op.payloadJson);
      await db.update(outboxOperations)
        .set({ payloadJson: writePayload({ ...payload, fields }), status: 'pending', lastError: null, nextAttemptAt: null })
        .where(eq(outboxOperations.id, op.id));
      requestSync();
      return;
    }
  }
  const group = item?.group;
  const payload: SavePlannedPayload = {
    key: item?.key ?? `new:${generateId()}`,
    fields,
    before: item?.fields ?? null,
    billId: group?.bill?.id ?? null,
    ruleId: group?.rule?.id ?? null,
    recurrenceId: group?.recurrence?.id ?? null,
  };
  await enqueueOperation(db, { id: generateId(), kind: 'save_planned', payload });
}

export async function deletePlanned(db: OutboxDb, item: PlannedItem): Promise<void> {
  let ids = { billId: item.group?.bill?.id ?? null, ruleId: item.group?.rule?.id ?? null, recurrenceId: item.group?.recurrence?.id ?? null };
  if (!item.group) {
    const op = await queuedSaveFor(db, item.key);
    if (op) {
      const payload = readPayload<SavePlannedPayload>(op.kind, op.payloadJson);
      await db.delete(outboxOperations).where(eq(outboxOperations.id, op.id));
      // Whatever an earlier attempt already created in FF3 still has to go.
      ids = { billId: payload.billId ?? null, ruleId: payload.ruleId ?? null, recurrenceId: payload.recurrenceId ?? null };
    }
  }
  if (!ids.billId && !ids.ruleId && !ids.recurrenceId) return;
  await enqueueOperation(db, { id: generateId(), kind: 'delete_planned', payload: { key: item.key, name: item.fields.name, ...ids } });
}
