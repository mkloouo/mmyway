import { createTestDb } from '../db/testDb';
import { pullUnreviewedRecurring, approveRecurringReview } from './recurringReview';
import { inboxItems, outboxOperations } from '../db/schema';

function fakeClient(data: unknown[]) {
  return { request: jest.fn(async () => ({ data })) };
}

describe('pullUnreviewedRecurring', () => {
  it('creates a review item for a recurring transaction without the reviewed tag', async () => {
    const db = createTestDb();
    const client = fakeClient([
      { id: 'g1', attributes: { transactions: [{ transaction_journal_id: 'j1', tags: ['recurring'], updated_at: '2026-09-01T00:00:00Z' }] } },
    ]);
    const created = await pullUnreviewedRecurring(db as any, client as any);
    expect(created).toBe(1);
    const rows = await db.select().from(inboxItems);
    expect(rows).toHaveLength(1);
  });

  it('skips a transaction that already has the reviewed tag', async () => {
    const db = createTestDb();
    const client = fakeClient([
      { id: 'g1', attributes: { transactions: [{ transaction_journal_id: 'j1', tags: ['recurring', 'mmyway-reviewed'], updated_at: '2026-09-01T00:00:00Z' }] } },
    ]);
    const created = await pullUnreviewedRecurring(db as any, client as any);
    expect(created).toBe(0);
  });

  it('does not duplicate a review item on a second pull', async () => {
    const db = createTestDb();
    const client = fakeClient([
      { id: 'g1', attributes: { transactions: [{ transaction_journal_id: 'j1', tags: ['recurring'], updated_at: '2026-09-01T00:00:00Z' }] } },
    ]);
    await pullUnreviewedRecurring(db as any, client as any);
    const secondRun = await pullUnreviewedRecurring(db as any, client as any);
    expect(secondRun).toBe(0);
  });
});

describe('approveRecurringReview', () => {
  it('enqueues a recurring_review outbox operation with the reviewed tag added', async () => {
    const db = createTestDb();
    const client = fakeClient([
      { id: 'g1', attributes: { transactions: [{ transaction_journal_id: 'j1', tags: ['recurring'], updated_at: '2026-09-01T00:00:00Z' }] } },
    ]);
    await pullUnreviewedRecurring(db as any, client as any);
    const item = (await db.select().from(inboxItems))[0]!;
    await approveRecurringReview(db as any, item.id);

    const ops = await db.select().from(outboxOperations);
    const payload = JSON.parse(ops[0]!.payloadJson);
    expect(payload.changes.tags).toContain('mmyway-reviewed');
  });
});
