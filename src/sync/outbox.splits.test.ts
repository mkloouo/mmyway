import { createTestDb } from '../db/testDb';
import { enqueueOperation, replayOutbox } from './outbox';
import { cachedTransactions, outboxOperations } from '../db/schema';
import { readSplits } from '../transactions/splitsJson';

const group = (updatedAt: string, splits: { id: string; amount: string; category: string }[]) => ({
  data: {
    id: 'g1',
    attributes: {
      updated_at: updatedAt,
      group_title: 'Biedronka',
      transactions: splits.map((s) => ({
        transaction_journal_id: s.id, type: 'withdrawal', date: '2026-09-01T10:00:00+02:00', amount: s.amount,
        currency_code: 'PLN', description: 'Biedronka', category_name: s.category, tags: [],
      })),
    },
  },
});

it('sends every split, deletes the removed one, and caches what FF3 answers', async () => {
  const db = createTestDb();
  await db.insert(cachedTransactions).values({
    groupId: 'g1', journalId: 'j1', type: 'withdrawal', date: '2026-09-01', amount: '100.00',
    currencyCode: 'PLN', description: 'Biedronka', tagsJson: '[]', splitCount: 3, updatedAt: 'v1', syncedAt: 's',
  });
  await enqueueOperation(db, {
    id: 'op-1', kind: 'update_transaction',
    payload: {
      groupId: 'g1', transactionJournalId: 'j1', expectedUpdatedAt: 'v1', changes: { amount: '100.00' },
      groupTitle: 'Biedronka',
      splits: [
        { transaction_journal_id: 'j1', amount: '60.00', category_name: 'Groceries' },
        { amount: '40.00', category_name: 'Home' },
      ],
      removedJournalIds: ['j2'],
    },
  });

  const calls: { path: string; method: string; body?: string }[] = [];
  const client = {
    request: jest.fn(async (path: string, init: RequestInit = {}) => {
      calls.push({ path, method: init.method ?? 'GET', body: init.body as string | undefined });
      if (path === '/v1/transaction-journals/j2') return undefined;
      if (init.method === 'PUT') return group('v2', [{ id: 'j1', amount: '60.00', category: 'Groceries' }, { id: 'j2', amount: '10.00', category: 'X' }, { id: 'j3', amount: '40.00', category: 'Home' }]);
      if (calls.filter((c) => c.path === '/v1/transactions/g1' && c.method === 'GET').length === 1) return group('v1', []);
      return group('v3', [{ id: 'j1', amount: '60.00', category: 'Groceries' }, { id: 'j3', amount: '40.00', category: 'Home' }]);
    }),
  };

  const result = await replayOutbox(db as never, client as never);
  expect(result.succeeded).toEqual(['op-1']);

  const put = calls.find((c) => c.method === 'PUT')!;
  expect(JSON.parse(put.body!)).toEqual({
    group_title: 'Biedronka',
    transactions: [
      { transaction_journal_id: 'j1', amount: '60.00', category_name: 'Groceries' },
      { amount: '40.00', category_name: 'Home' },
    ],
  });
  expect(calls).toContainEqual({ path: '/v1/transaction-journals/j2', method: 'DELETE', body: undefined });

  const [row] = await db.select().from(cachedTransactions);
  expect(row?.updatedAt).toBe('v3');
  expect(readSplits(row?.splitsJson)?.map((s) => s.journalId)).toEqual(['j1', 'j3']);
  expect(await db.select().from(outboxOperations)).toHaveLength(0);
});
