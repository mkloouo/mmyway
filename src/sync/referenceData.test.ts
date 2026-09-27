import { createTestDb } from '../db/testDb';
import { pullRecentTransactions, pullReferenceData } from './referenceData';
import { cachedTransactions, referenceAccounts } from '../db/schema';

function fakeClient(pages: unknown[][]) {
  let call = 0;
  return { request: jest.fn(async (_path: string) => ({ data: pages[call++] ?? [] })) };
}

function journalGroup(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    attributes: {
      transactions: [{
        transaction_journal_id: `${id}-j`, type: 'withdrawal', date: '2026-09-01', amount: '1.00',
        currency_code: 'PLN', description: 'x', tags: [], updated_at: '2026-09-01T00:00:00Z',
        ...overrides,
      }],
    },
  };
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

  it('backfills three months when nothing is cached, then only a short catch-up window', async () => {
    const db = createTestDb();
    const today = new Date();
    const threeMonthsBack = new Date();
    threeMonthsBack.setMonth(threeMonthsBack.getMonth() - 3);

    const first = fakeClient([[journalGroup('g1', { date: today.toISOString().slice(0, 10) })]]);
    await pullRecentTransactions(db as any, first as any, '2026-09-27T00:00:00Z');
    expect(first.request.mock.calls[0]![0]).toContain(`start=${threeMonthsBack.toISOString().slice(0, 10)}`);

    const catchUp = new Date(today);
    catchUp.setDate(catchUp.getDate() - 14);
    const second = fakeClient([[]]);
    await pullRecentTransactions(db as any, second as any, '2026-09-28T00:00:00Z');
    expect(second.request.mock.calls[0]![0]).toContain(`start=${catchUp.toISOString().slice(0, 10)}`);
  });

  it('pages past 20 pages when the history window has more than 2000 transactions', async () => {
    const db = createTestDb();
    const fullPages = Array.from({ length: 21 }, (_, i) => Array.from({ length: 100 }, (_, j) => journalGroup(`p${i}-${j}`)));
    const client = fakeClient([...fullPages, []]); // 21 full pages, then an empty page stops the loop
    await pullRecentTransactions(db as any, client as any, '2026-09-27T00:00:00Z');

    expect(client.request).toHaveBeenCalledTimes(22);
    const rows = await db.select().from(cachedTransactions);
    expect(rows).toHaveLength(2100);
  });
});

describe('pullReferenceData', () => {
  function fakeReferenceClient() {
    const calls: string[] = [];
    return {
      calls,
      request: jest.fn(async (path: string) => {
        calls.push(path);
        if (path.startsWith('/v1/accounts')) {
          return {
            data: [{
              id: 'acc-1',
              attributes: {
                name: 'Cash', type: 'asset', currency_code: 'PLN', active: true,
                current_balance: '340.00', current_balance_date: '2026-09-27',
              },
            }],
          };
        }
        if (path.startsWith('/v1/categories')) return { data: [] };
        if (path.startsWith('/v1/budgets')) return { data: [] };
        if (path.startsWith('/v1/currencies')) return { data: [] };
        return { data: [] }; // transactions pull
      }),
    };
  }

  it('the balance and its date survive a pull', async () => {
    const db = createTestDb();
    await pullReferenceData(db as any, fakeReferenceClient() as any);

    const [account] = await db.select().from(referenceAccounts);
    expect(account).toMatchObject({ id: 'acc-1', currentBalance: '340.00', currentBalanceDate: '2026-09-27' });
  });

  it('the balance survives an update on a second pull', async () => {
    const db = createTestDb();
    await pullReferenceData(db as any, fakeReferenceClient() as any);

    const updatedClient = fakeReferenceClient();
    updatedClient.request.mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/accounts')) {
        return { data: [{ id: 'acc-1', attributes: { name: 'Cash', type: 'asset', currency_code: 'PLN', active: true, current_balance: '280.00', current_balance_date: '2026-09-28' } }] };
      }
      return { data: [] };
    });
    await pullReferenceData(db as any, updatedClient as any);

    const [account] = await db.select().from(referenceAccounts);
    expect(account).toMatchObject({ currentBalance: '280.00', currentBalanceDate: '2026-09-28' });
  });
});
