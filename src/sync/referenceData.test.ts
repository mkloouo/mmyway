import { createTestDb } from '../db/testDb';
import { pullRecentTransactions } from './referenceData';
import { cachedTransactions } from '../db/schema';

function fakeClient(pages: unknown[][]) {
  let call = 0;
  return { request: jest.fn(async () => ({ data: pages[call++] ?? [] })) };
}

describe('pullRecentTransactions', () => {
  it('caches the first split of each transaction group, keyed by groupId', async () => {
    const db = createTestDb();
    const client = fakeClient([
      [{ id: 'g1', attributes: { transactions: [{
        transaction_journal_id: 'j1', type: 'withdrawal', date: '2026-09-01', amount: '12.34',
        currency_code: 'PLN', description: 'coffee', destination_name: 'Cafe', category_name: 'Food',
        tags: [], updated_at: '2026-09-01T00:00:00Z',
      }] } }],
    ]);

    await pullRecentTransactions(db as any, client as any, '2026-09-27T00:00:00Z');

    const rows = await db.select().from(cachedTransactions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ groupId: 'g1', journalId: 'j1', destinationName: 'Cafe', categoryName: 'Food' });
  });

  it('stops paging once a page comes back short of the page size', async () => {
    const db = createTestDb();
    const client = fakeClient([[], []]); // empty first page -> loop should stop after page 1
    await pullRecentTransactions(db as any, client as any, '2026-09-27T00:00:00Z');
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('upserts on a repeated pull instead of duplicating the row', async () => {
    const db = createTestDb();
    const journal = {
      transaction_journal_id: 'j1', type: 'withdrawal', date: '2026-09-01', amount: '12.34',
      currency_code: 'PLN', description: 'coffee', tags: [], updated_at: '2026-09-01T00:00:00Z',
    };
    const client = fakeClient([[{ id: 'g1', attributes: { transactions: [journal] } }]]);
    await pullRecentTransactions(db as any, client as any, '2026-09-27T00:00:00Z');

    const client2 = fakeClient([[{ id: 'g1', attributes: { transactions: [{ ...journal, amount: '99.00' }] } }]]);
    await pullRecentTransactions(db as any, client2 as any, '2026-09-28T00:00:00Z');

    const rows = await db.select().from(cachedTransactions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe('99.00');
  });

  it('reads updated_at from the group, not the split (real FF3 responses put it there, not in TransactionSplit)', async () => {
    const db = createTestDb();
    const client = fakeClient([
      [{
        id: 'g1',
        attributes: {
          updated_at: '2026-09-20T12:00:00Z', // group-level, as real FF3 responses shape it
          transactions: [{
            transaction_journal_id: 'j1', type: 'withdrawal', date: '2026-09-01', amount: '12.34',
            currency_code: 'PLN', description: 'coffee', tags: [],
            // no updated_at on the split itself
          }],
        },
      }],
    ]);

    await pullRecentTransactions(db as any, client as any, '2026-09-27T00:00:00Z');

    const rows = await db.select().from(cachedTransactions);
    expect(rows[0]!.updatedAt).toBe('2026-09-20T12:00:00Z');
  });
});
