import { createTestDb } from '../db/testDb';
import { outboxOperations } from '../db/schema';
import { readPayload } from '../sync/payloadJson';
import { assignMany, assignToEnvelope, moveBetweenEnvelopes } from './actions';
import type { SetBudgetLimitsPayload } from './replay';

jest.mock('../sync/syncTrigger', () => ({ requestSync: jest.fn(), retryUnsent: jest.fn() }));

const PERIOD = { start: '2026-10-01', end: '2026-10-31' };

const envelope = (over: Partial<Record<string, string | null>> = {}) => ({
  budgetId: '1',
  limitId: '41',
  assigned: '200.00',
  available: '150.00',
  ...over,
});

async function ops(db: ReturnType<typeof createTestDb>) {
  const rows = await db.select().from(outboxOperations);
  return rows.map((row) => ({
    kind: row.kind,
    payload: readPayload<SetBudgetLimitsPayload>(row.kind, row.payloadJson),
  }));
}

describe('assignToEnvelope', () => {
  it('queues one absolute amount for the period', async () => {
    const db = createTestDb();
    await assignToEnvelope(db as never, PERIOD, 'PLN', envelope() as never, '500.00');
    expect(await ops(db)).toEqual([
      {
        kind: 'set_budget_limits',
        payload: {
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
          currencyCode: 'PLN',
          entries: [{ budgetId: '1', amount: '500.00', limitId: '41' }],
        },
      },
    ]);
  });
});

describe('moveBetweenEnvelopes', () => {
  const from = envelope({ budgetId: '1', limitId: '41', assigned: '200.00', available: '150.00' });
  const to = envelope({ budgetId: '2', limitId: '42', assigned: '100.00' });

  it('is ONE operation carrying both sides, never two', async () => {
    const db = createTestDb();
    await moveBetweenEnvelopes(db as never, PERIOD, 'PLN', from as never, to as never, '50.00');

    const queued = await ops(db);
    // The reason this matters: queued separately, a landed decrement with a failed increment
    // would take the money out of the budget with nothing left to put it back.
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload.entries).toEqual([
      { budgetId: '1', amount: '150.00', limitId: '41' },
      { budgetId: '2', amount: '150.00', limitId: '42' },
    ]);
  });

  it('never takes more than the giver has left, so its spending stays covered', async () => {
    const db = createTestDb();
    await moveBetweenEnvelopes(db as never, PERIOD, 'PLN', from as never, to as never, '999.00');
    // Capped at the giver's `available` (150), not at its `assigned` (200).
    expect((await ops(db))[0]!.payload.entries).toEqual([
      { budgetId: '1', amount: '50.00', limitId: '41' },
      { budgetId: '2', amount: '250.00', limitId: '42' },
    ]);
  });

  it('queues nothing for a zero or negative move', async () => {
    const db = createTestDb();
    await moveBetweenEnvelopes(db as never, PERIOD, 'PLN', from as never, to as never, '0');
    await moveBetweenEnvelopes(db as never, PERIOD, 'PLN', from as never, to as never, '-5.00');
    expect(await ops(db)).toEqual([]);
  });

  it('leaves the total across the two envelopes untouched', async () => {
    const db = createTestDb();
    await moveBetweenEnvelopes(db as never, PERIOD, 'PLN', from as never, to as never, '50.00');
    const entries = (await ops(db))[0]!.payload.entries;
    const total = entries.reduce((sum, e) => sum + Number(e.amount), 0);
    expect(total).toBe(Number(from.assigned) + Number(to.assigned));
  });
});

describe('assignMany', () => {
  it('queues one operation for every entry', async () => {
    const db = createTestDb();
    await assignMany(db as never, PERIOD, 'PLN', [
      { budgetId: '1', amount: '10.00' },
      { budgetId: '2', amount: '20.00' },
    ]);
    const queued = await ops(db);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload.entries).toHaveLength(2);
  });

  it('queues nothing when there is nothing to assign', async () => {
    const db = createTestDb();
    await assignMany(db as never, PERIOD, 'PLN', []);
    expect(await ops(db)).toEqual([]);
  });
});
