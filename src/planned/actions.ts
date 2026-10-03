// Queues the Planned tab's saves and deletes. Like account edits they go through the outbox, so
// they work offline and reach FF3 in order with everything else.
import { and, eq } from 'drizzle-orm';
import { outboxOperations } from '../db/schema';
import { enqueueOperation, isUnsent, type OutboxDb } from '../sync/outbox';
import { readPayload, writePayload } from '../sync/payloadJson';
import { requestSync } from '../sync/syncTrigger';
import { generateId } from '../utils/id';
import type { PlannedItem } from './items';
import { withScheduleOf, type PlannedFields } from './model';
import type { SavePlannedPayload } from './replay';

/** The queued save of a planned transaction that isn't in FF3 yet, while it can still be changed. */
async function queuedSaveFor(db: OutboxDb, key: string) {
  const ops = await db
    .select()
    .from(outboxOperations)
    .where(and(eq(outboxOperations.kind, 'save_planned'), isUnsent()));
  return (
    ops.find((op) => readPayload<SavePlannedPayload>(op.kind, op.payloadJson).key === key) ?? null
  );
}

export async function savePlanned(
  db: OutboxDb,
  item: PlannedItem | null,
  fields: PlannedFields,
): Promise<void> {
  if (item) {
    // A save of this one still waiting to be sent takes the new fields rather than queueing a
    // second change for the same planned transaction (two identical cards in the Inbox's queue).
    // Its `before` stays what FF3 holds, so the schedule diff stays right — including a
    // recurring transaction it already replaced, which has the queued schedule by now: the new
    // fields replace it again only if they move the schedule further.
    const op = await queuedSaveFor(db, item.key);
    if (op) {
      const payload = readPayload<SavePlannedPayload>(op.kind, op.payloadJson);
      const merged: SavePlannedPayload =
        payload.recurrenceReplaced && payload.before
          ? {
              ...payload,
              fields,
              before: withScheduleOf(payload.before, payload.fields),
              recurrenceReplaced: false,
            }
          : { ...payload, fields };
      await db
        .update(outboxOperations)
        .set({
          payloadJson: writePayload(merged),
          status: 'pending',
          lastError: null,
          nextAttemptAt: null,
        })
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

/**
 * Books the next occurrence now instead of waiting for its day (#44) — testing a new recurrence,
 * or paying one early. Queued like the saves above, so it lands after a schedule change still
 * waiting to be sent rather than firing the schedule FF3 still holds.
 */
export async function triggerPlanned(db: OutboxDb, item: PlannedItem): Promise<void> {
  const recurrenceId = item.group?.recurrence?.id;
  if (!recurrenceId) return;
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'trigger_planned',
    payload: {
      key: item.key,
      name: item.fields.name,
      recurrenceId,
      date: item.fields.date,
    },
  });
}

export async function deletePlanned(db: OutboxDb, item: PlannedItem): Promise<void> {
  let ids = {
    billId: item.group?.bill?.id ?? null,
    ruleId: item.group?.rule?.id ?? null,
    recurrenceId: item.group?.recurrence?.id ?? null,
  };
  if (!item.group) {
    const op = await queuedSaveFor(db, item.key);
    if (op) {
      const payload = readPayload<SavePlannedPayload>(op.kind, op.payloadJson);
      await db.delete(outboxOperations).where(eq(outboxOperations.id, op.id));
      // Whatever an earlier attempt already created in FF3 still has to go.
      ids = {
        billId: payload.billId ?? null,
        ruleId: payload.ruleId ?? null,
        recurrenceId: payload.recurrenceId ?? null,
      };
    }
  }
  if (!ids.billId && !ids.ruleId && !ids.recurrenceId) return;
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'delete_planned',
    payload: { key: item.key, name: item.fields.name, ...ids },
  });
}
