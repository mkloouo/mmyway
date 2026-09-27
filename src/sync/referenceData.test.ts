import { createTestDb } from '../db/testDb';
import { pullRecentTransactions, pullOlderTransactions, pullReferenceData } from './referenceData';
import { cachedTransactions, referenceAccounts } from '../db/schema';
import { enqueueOperation } from './outbox';

// `totals` overrides meta.pagination.total per call index — real FF3 responses always carry it,
// and pullOlderTransactions' anyTransactionsBefore probe reads it to tell a quiet chunk from the
// actual end of history. Defaults to the page's own length, which keeps every other test (which
// never looks at meta) working unchanged.
function fakeClient(pages: unknown[][], totals: (number | undefined)[] = []) {
  let call = 0;
  return {
    request: jest.fn(async (_path: string) => {
      const i = call++;
      const data = pages[i] ?? [];
      return { data, meta: { pagination: { total: totals[i] ?? data.length } } };
    }),
  };
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

describe('pullOlderTransactions', () => {
  it('reaches back a further chunk before the oldest cached row and reports it found older history', async () => {
    const db = createTestDb();
    const seed = fakeClient([[journalGroup('g1', { date: '2026-06-01' })]]);
    await pullRecentTransactions(db as any, seed as any, '2026-09-27T00:00:00Z');

    const older = fakeClient([[journalGroup('g0', { date: '2026-03-15' })]]);
    const foundOlder = await pullOlderTransactions(db as any, older as any, '2026-09-27T00:00:00Z');

    expect(foundOlder).toBe(true);
    expect(older.request.mock.calls[0]![0]).toContain('start=2026-03-01');
    expect(older.request.mock.calls[0]![0]).toContain('end=2026-05-31');
    const rows = await db.select().from(cachedTransactions);
    expect(rows.map((r) => r.groupId).sort()).toEqual(['g0', 'g1']);
  });

  it('reports no older history once FF3 confirms nothing exists before the quiet chunk', async () => {
    const db = createTestDb();
    const seed = fakeClient([[journalGroup('g1', { date: '2026-06-01' })]]);
    await pullRecentTransactions(db as any, seed as any, '2026-09-27T00:00:00Z');

    // page 1 of the chunk is empty, and the probe call after it reports total: 0 (default, since
    // an empty page's own length is 0) — genuinely nothing older exists.
    const empty = fakeClient([[]]);
    const foundOlder = await pullOlderTransactions(db as any, empty as any, '2026-09-27T00:00:00Z');

    expect(foundOlder).toBe(false);
  });

  it('walks a year at a time once the cache already reaches back more than a year', async () => {
    const db = createTestDb();
    // 2025-06-01 is more than a year before "now" (2026-09-27), so the chunk past it should be a
    // full year wide rather than the usual 3 months — a thin, long-lived account otherwise takes
    // dozens of scrolls to reach anything old.
    const seed = fakeClient([[journalGroup('g1', { date: '2025-06-01' })]]);
    await pullRecentTransactions(db as any, seed as any, '2026-09-27T00:00:00Z');

    const older = fakeClient([[journalGroup('g0', { date: '2024-08-01' })]]);
    const foundOlder = await pullOlderTransactions(db as any, older as any, '2026-09-27T00:00:00Z');

    expect(foundOlder).toBe(true);
    expect(older.request.mock.calls[0]![0]).toContain('start=2024-06-01');
    expect(older.request.mock.calls[0]![0]).toContain('end=2025-05-31');
  });

  it('widens past a quiet chunk when FF3 reports older history still exists beyond it', async () => {
    const db = createTestDb();
    const seed = fakeClient([[journalGroup('g1', { date: '2026-06-01' })]]);
    await pullRecentTransactions(db as any, seed as any, '2026-09-27T00:00:00Z');

    // First chunk (2026-03-01..2026-05-31) is quiet, but the probe (call index 1) says total: 1 —
    // more history exists — so a second, further-back chunk is walked and finds it.
    const client = fakeClient(
      [[], [], [journalGroup('g0', { date: '2025-12-01' })]],
      [undefined, 1],
    );
    const foundOlder = await pullOlderTransactions(db as any, client as any, '2026-09-27T00:00:00Z');

    expect(foundOlder).toBe(true);
    expect(client.request.mock.calls).toHaveLength(3);
    expect(client.request.mock.calls[2]![0]).toContain('start=2025-12-01');
    const rows = await db.select().from(cachedTransactions);
    expect(rows.map((r) => r.groupId).sort()).toEqual(['g0', 'g1']);
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

describe('transactions deleted in FF3', () => {
  it('drops a cached row inside the pulled window that FF3 no longer returns, keeping ones an op still needs', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const db = createTestDb();
    const seed = fakeClient([[journalGroup('kept', { date: today }), journalGroup('deleted-in-web', { date: today }), journalGroup('queued-edit', { date: today })]]);
    await pullRecentTransactions(db as any, seed as any, `${today}T00:00:00Z`);
    await enqueueOperation(db, { id: 'op', kind: 'update_transaction', payload: { groupId: 'queued-edit', transactionJournalId: 'j', expectedUpdatedAt: 'x', changes: {} } });

    // Next sync: FF3 only returns `kept` for the same window.
    await pullRecentTransactions(db as any, fakeClient([[journalGroup('kept', { date: today })]]) as any, `${today}T01:00:00Z`);

    const ids = (await db.select().from(cachedTransactions)).map((r) => r.groupId).sort();
    expect(ids).toEqual(['kept', 'queued-edit']);
  });
});
