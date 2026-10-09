import { createTestDb } from '../db/testDb';
import { enqueueOperation, replayOutbox } from './outbox';
import { cachedTransactions } from '../db/schema';

it('sends a cleared category and budget as null, so Firefly III drops them', async () => {
  const db = createTestDb();
  await db.insert(cachedTransactions).values({
    groupId: 'g1',
    journalId: 'j1',
    type: 'withdrawal',
    date: '2026-09-01',
    amount: '10.00',
    currencyCode: 'PLN',
    description: 'Coffee',
    categoryName: 'Food',
    budgetId: '3',
    tagsJson: '[]',
    updatedAt: 'v1',
    syncedAt: 's',
  });
  await enqueueOperation(db, {
    id: 'op-1',
    kind: 'update_transaction',
    payload: {
      groupId: 'g1',
      transactionJournalId: 'j1',
      expectedUpdatedAt: 'v1',
      changes: { category_name: null, budget_id: null },
    },
  });
  const bodies: string[] = [];
  const read = (updatedAt: string) => ({
    data: {
      id: 'g1',
      attributes: {
        updated_at: updatedAt,
        transactions: [
          {
            transaction_journal_id: 'j1',
            type: 'withdrawal',
            date: '2026-09-01T10:00:00+02:00',
            amount: '10.00',
            currency_code: 'PLN',
            description: 'Coffee',
            tags: [],
          },
        ],
      },
    },
  });
  const client = {
    request: jest.fn(async (_path: string, init: RequestInit = {}) => {
      if (init.method !== 'PUT') return read('v1');
      bodies.push(String(init.body));
      return read('v2');
    }),
  };

  const result = await replayOutbox(db as never, client as never);

  expect(result.succeeded).toEqual(['op-1']);
  expect(JSON.parse(bodies[0]!).transactions[0]).toMatchObject({
    category_name: null,
    budget_id: null,
  });
});

it('sends tags as [] when cleared on an update so Firefly III drops them', async () => {
  const db = createTestDb();
  await db.insert(cachedTransactions).values({
    groupId: 'g2',
    journalId: 'j2',
    type: 'withdrawal',
    date: '2026-09-01',
    amount: '15.00',
    currencyCode: 'PLN',
    description: 'Book',
    tagsJson: '["old-tag"]',
    updatedAt: 'v1',
    syncedAt: 's',
  });
  await enqueueOperation(db, {
    id: 'op-2',
    kind: 'update_transaction',
    payload: {
      groupId: 'g2',
      transactionJournalId: 'j2',
      expectedUpdatedAt: 'v1',
      changes: { tags: [] },
    },
  });
  const bodies: string[] = [];
  const read = (updatedAt: string) => ({
    data: {
      id: 'g2',
      attributes: {
        updated_at: updatedAt,
        transactions: [
          {
            transaction_journal_id: 'j2',
            type: 'withdrawal',
            date: '2026-09-01T10:00:00+02:00',
            amount: '15.00',
            currency_code: 'PLN',
            description: 'Book',
            tags: [],
          },
        ],
      },
    },
  });
  const client = {
    request: jest.fn(async (_path: string, init: RequestInit = {}) => {
      if (init.method !== 'PUT') return read('v1');
      bodies.push(String(init.body));
      return read('v2');
    }),
  };

  const result = await replayOutbox(db as never, client as never);

  expect(result.succeeded).toEqual(['op-2']);
  expect(JSON.parse(bodies[0]!).transactions[0].tags).toEqual([]);
});
