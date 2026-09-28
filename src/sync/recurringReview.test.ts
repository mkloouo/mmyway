import { createTestDb } from '../db/testDb';
import {
  pullUnreviewedRecurring,
  approveRecurringReview,
  editRecurringReview,
  deleteRecurringReview,
} from './recurringReview';
import { replayOutbox } from './outbox';
import { inboxItems, outboxOperations, cachedTransactions } from '../db/schema';

function fakeClient(data: unknown[]) {
  return { request: jest.fn(async () => ({ data })) };
}

describe('pullUnreviewedRecurring', () => {
  it('creates a review item for a recurring transaction without the reviewed tag', async () => {
    const db = createTestDb();
    const client = fakeClient([
      {
        id: 'g1',
        attributes: {
          transactions: [
            {
              transaction_journal_id: 'j1',
              recurrence_id: '1',
              tags: ['recurring'],
              updated_at: '2026-09-01T00:00:00Z',
            },
          ],
        },
      },
    ]);
    const created = await pullUnreviewedRecurring(db as any, client as any);
    expect(created).toBe(1);
    const rows = await db.select().from(inboxItems);
    expect(rows).toHaveLength(1);
  });

  it('picks transactions by recurrence_id, since FF3 tags nothing it books (early triggers included)', async () => {
    const db = createTestDb();
    const client = fakeClient([
      {
        id: 'g1',
        attributes: {
          transactions: [{ transaction_journal_id: 'j1', recurrence_id: 7, tags: [] }],
        },
      },
      {
        id: 'g2',
        attributes: {
          transactions: [{ transaction_journal_id: 'j2', recurrence_id: null, tags: [] }],
        },
      },
    ]);
    expect(await pullUnreviewedRecurring(db as any, client as any)).toBe(1);
    const [path] = (client.request as jest.Mock).mock.calls[0]!;
    expect(path).toMatch(/^\/v1\/transactions\?start=\d{4}-\d\d-\d\d&end=\d{4}-\d\d-\d\d/);
  });

  it('reads updated_at from the group, not the split, when storing the review draft', async () => {
    const db = createTestDb();
    const client = fakeClient([
      {
        id: 'g1',
        attributes: {
          updated_at: '2026-09-20T12:00:00Z', // group-level, as real FF3 responses shape it
          transactions: [{ transaction_journal_id: 'j1', recurrence_id: '1', tags: ['recurring'] }], // no updated_at on the split
        },
      },
    ]);
    await pullUnreviewedRecurring(db as any, client as any);

    const item = (await db.select().from(inboxItems))[0]!;
    const journal = JSON.parse(item.draftJson);
    expect(journal.updated_at).toBe('2026-09-20T12:00:00Z');
  });

  it('skips a transaction that already has the reviewed tag', async () => {
    const db = createTestDb();
    const client = fakeClient([
      {
        id: 'g1',
        attributes: {
          transactions: [
            {
              transaction_journal_id: 'j1',
              recurrence_id: '1',
              tags: ['recurring', 'mmyway-reviewed'],
              updated_at: '2026-09-01T00:00:00Z',
            },
          ],
        },
      },
    ]);
    const created = await pullUnreviewedRecurring(db as any, client as any);
    expect(created).toBe(0);
  });

  it('does not duplicate a review item on a second pull', async () => {
    const db = createTestDb();
    const client = fakeClient([
      {
        id: 'g1',
        attributes: {
          transactions: [
            {
              transaction_journal_id: 'j1',
              recurrence_id: '1',
              tags: ['recurring'],
              updated_at: '2026-09-01T00:00:00Z',
            },
          ],
        },
      },
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
      {
        id: 'g1',
        attributes: {
          transactions: [
            {
              transaction_journal_id: 'j1',
              recurrence_id: '1',
              tags: ['recurring'],
              updated_at: '2026-09-01T00:00:00Z',
            },
          ],
        },
      },
    ]);
    await pullUnreviewedRecurring(db as any, client as any);
    const item = (await db.select().from(inboxItems))[0]!;
    await approveRecurringReview(db as any, item.id);

    const ops = await db.select().from(outboxOperations);
    const payload = JSON.parse(ops[0]!.payloadJson);
    expect(payload.changes.tags).toContain('mmyway-reviewed');
  });
});

describe('editRecurringReview', () => {
  it('enqueues a partial PUT keyed by transaction_journal_id with the review tag added (R2/R3)', async () => {
    const db = createTestDb();
    const client = fakeClient([
      {
        id: 'g1',
        attributes: {
          transactions: [
            {
              transaction_journal_id: 'j1',
              recurrence_id: '1',
              tags: ['recurring'],
              updated_at: '2026-09-01T00:00:00Z',
            },
          ],
        },
      },
    ]);
    await pullUnreviewedRecurring(db as any, client as any);
    const item = (await db.select().from(inboxItems))[0]!;

    await editRecurringReview(db as any, item.id, {
      amount: '99.00',
      currency_code: 'EUR',
      source_id: 'acc-1',
    });

    const ops = await db.select().from(outboxOperations);
    expect(ops).toHaveLength(1);
    const payload = JSON.parse(ops[0]!.payloadJson);
    expect(payload.transactionJournalId).toBe('j1');
    expect(payload.changes).toMatchObject({
      amount: '99.00',
      currency_code: 'EUR',
      source_id: 'acc-1',
    });
    expect(payload.changes.tags).toContain('mmyway-reviewed');
  });
});

describe('deleteRecurringReview', () => {
  it('enqueues a conflict-checked delete', async () => {
    const db = createTestDb();
    const client = fakeClient([
      {
        id: 'g1',
        attributes: {
          transactions: [
            {
              transaction_journal_id: 'j1',
              recurrence_id: '1',
              tags: ['recurring'],
              updated_at: '2026-09-01T00:00:00Z',
            },
          ],
        },
      },
    ]);
    await pullUnreviewedRecurring(db as any, client as any);
    const item = (await db.select().from(inboxItems))[0]!;

    await deleteRecurringReview(db as any, item.id);

    const ops = await db.select().from(outboxOperations);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe('delete_transaction');
    const payload = JSON.parse(ops[0]!.payloadJson);
    expect(payload).toMatchObject({ groupId: 'g1', expectedUpdatedAt: '2026-09-01T00:00:00Z' });
  });

  it('surfaces a stale updated_at as a conflict instead of deleting (Review Focus)', async () => {
    const db = createTestDb();
    const client = fakeClient([
      {
        id: 'g1',
        attributes: {
          transactions: [
            {
              transaction_journal_id: 'j1',
              recurrence_id: '1',
              tags: ['recurring'],
              updated_at: '2026-09-01T00:00:00Z',
            },
          ],
        },
      },
    ]);
    await pullUnreviewedRecurring(db as any, client as any);
    const item = (await db.select().from(inboxItems))[0]!;
    await deleteRecurringReview(db as any, item.id);

    // The server's own cache says the transaction changed after the review was pulled.
    await db.insert(cachedTransactions).values({
      groupId: 'g1',
      journalId: 'j1',
      type: 'withdrawal',
      date: '2026-09-01',
      amount: '10.00',
      currencyCode: 'PLN',
      description: 'test',
      tagsJson: '[]',
      updatedAt: '2026-09-15T00:00:00Z',
      syncedAt: '2026-09-15T00:00:00Z',
    });

    const replayClient = {
      request: jest.fn(async () => {
        throw new Error('DELETE must not be called on conflict');
      }),
    };
    const result = await replayOutbox(db as any, replayClient as any);

    expect(result.conflicted).toHaveLength(1);
    expect(replayClient.request).not.toHaveBeenCalled();
  });
});
