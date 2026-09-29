import { createTestDb } from '../db/testDb';
import { outboxOperations } from '../db/schema';
import { readPayload } from '../sync/payloadJson';
import { savePlanned } from './actions';
import type { PlannedItem } from './items';
import type { PlannedFields, PlannedGroup } from './model';
import type { SavePlannedPayload } from './replay';

const fields: PlannedFields = {
  name: 'Play24 - Internet 5G',
  type: 'withdrawal',
  sourceId: '1',
  sourceName: 'PKO',
  destinationId: null,
  destinationName: 'Zina',
  amount: '60',
  currencyCode: 'PLN',
  notes: null,
  repeats: true,
  frequency: 'monthly',
  every: 1,
  date: '2026-10-05',
  time: null,
  categoryName: null,
  tags: [],
};
const group = {
  key: 'play24internet5g',
  name: fields.name,
  bill: { id: '2' },
  recurrence: { id: '3' },
} as unknown as PlannedGroup;
const inFF3: PlannedItem = { key: group.key, fields, group, queued: false };

async function saves(db: ReturnType<typeof createTestDb>) {
  const ops = await db.select().from(outboxOperations);
  return ops.map((op) => ({
    status: op.status,
    payload: readPayload<SavePlannedPayload>(op.kind, op.payloadJson),
  }));
}

describe('savePlanned', () => {
  it('folds a second edit of a planned transaction into the save still waiting to be sent', async () => {
    const db = createTestDb();
    await savePlanned(db as any, inFF3, { ...fields, date: '2026-10-12' });
    // Reopened, the editor starts from the queued fields.
    await savePlanned(
      db as any,
      { ...inFF3, fields: { ...fields, date: '2026-10-12' }, queued: true },
      { ...fields, date: '2026-10-12', amount: '65' },
    );

    const queued = await saves(db);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toMatchObject({
      billId: '2',
      recurrenceId: '3',
      fields: { date: '2026-10-12', amount: '65' },
    });
    // Still what FF3 holds: the schedule change is sent even though the second edit didn't move the date.
    expect(queued[0]!.payload.before).toMatchObject({ date: '2026-10-05', amount: '60' });
  });

  it('sends a failed save again with the new fields', async () => {
    const db = createTestDb();
    await savePlanned(db as any, inFF3, { ...fields, date: '2026-10-12' });
    await db.update(outboxOperations).set({ status: 'failed', lastError: 'boom' });
    await savePlanned(db as any, inFF3, { ...fields, date: '2026-10-19' });

    const queued = await saves(db);
    expect(queued).toEqual([
      expect.objectContaining({
        status: 'pending',
        payload: expect.objectContaining({
          fields: expect.objectContaining({ date: '2026-10-19' }),
        }),
      }),
    ]);
  });

  it('after the recurring transaction was replaced, replaces it again only if the schedule moves further', async () => {
    const db = createTestDb();
    await savePlanned(db as any, inFF3, { ...fields, date: '2026-10-12' });
    // A first attempt replaced the recurring transaction (so it has the 12th), then failed on the rule.
    const [op] = await db.select().from(outboxOperations);
    const sent = readPayload<SavePlannedPayload>(op!.kind, op!.payloadJson);
    await db.update(outboxOperations).set({
      status: 'failed',
      payloadJson: JSON.stringify({
        ...sent,
        recurrenceId: '30',
        recurrenceReplaced: true,
        v: 1,
      }),
    });

    await savePlanned(db as any, inFF3, { ...fields, date: '2026-10-12', amount: '65' });
    const [merged] = await saves(db);
    expect(merged!.payload).toMatchObject({
      recurrenceId: '30',
      recurrenceReplaced: false,
      before: { date: '2026-10-12', amount: '60' },
    });
  });

  it('leaves a save that is already being sent alone and queues another', async () => {
    const db = createTestDb();
    await savePlanned(db as any, inFF3, { ...fields, date: '2026-10-12' });
    await db.update(outboxOperations).set({ status: 'in_flight' });
    await savePlanned(db as any, inFF3, { ...fields, date: '2026-10-19' });
    expect(await saves(db)).toHaveLength(2);
  });
});
