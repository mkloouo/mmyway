import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { enqueueOperation, replayOutbox } from './outbox';
import { FF3RequestError } from '../api/ff3/client';
import { outboxOperations, cachedTransactions, inboxItems } from '../db/schema';

function fakeClient(handlers: Record<string, () => Promise<unknown>>) {
  return {
    request: jest.fn(async (path: string) => {
      const handler = Object.entries(handlers).find(([key]) => path.includes(key));
      if (!handler) throw new Error(`no handler for ${path}`);
      return handler[1]();
    }),
  };
}

describe('replayOutbox', () => {
  it('replays in sequence order; a failure holds back only what depends on it (#41)', async () => {
    const db = createTestDb();
    await enqueueOperation(db, {
      id: 'op-1',
      kind: 'create_transaction',
      payload: { clientId: 'c1', splits: [] },
    });
    await enqueueOperation(db, {
      id: 'op-2',
      kind: 'create_transaction',
      payload: { clientId: 'c2', splits: [] },
    });
    await enqueueOperation(db, {
      id: 'op-3',
      kind: 'create_transaction',
      payload: { clientId: 'c3', splits: [] },
    });

    let calls = 0;
    const client = fakeClient({
      '/v1/transactions': async () => {
        calls += 1;
        if (calls === 2) throw new FF3RequestError(422, '{"message":"The amount is invalid."}');
        return {};
      },
    });

    const result = await replayOutbox(db as any, client as any);

    // op-3 shares nothing with op-2, so op-2's own failure doesn't hold it back.
    expect(result.succeeded).toEqual(['op-1', 'op-3']);
    expect(result.failedAt).toBe('op-2');
    const rows = await db.select().from(outboxOperations);
    expect(rows.map((r) => [r.id, r.status])).toEqual([['op-2', 'failed']]);
  });

  it('stops the whole run when FF3 cannot be reached', async () => {
    const db = createTestDb();
    for (const id of ['op-1', 'op-2']) {
      await enqueueOperation(db, {
        id,
        kind: 'create_transaction',
        payload: { clientId: id, splits: [] },
      });
    }
    const client = fakeClient({
      '/v1/transactions': async () => {
        throw new TypeError('Network request failed');
      },
    });

    const result = await replayOutbox(db as any, client as any);

    expect(client.request).toHaveBeenCalledTimes(1); // op-2 would fail the same way: not tried
    expect(result.failedAt).toBe('op-1');
    const op2 = (await db.select().from(outboxOperations)).find((r) => r.id === 'op-2');
    expect(op2?.status).toBe('pending');
  });

  it('holds back a change to the same transaction, and whatever depends on that in turn', async () => {
    const db = createTestDb();
    const del = (id: string, groupId: string) =>
      enqueueOperation(db, { id, kind: 'delete_transaction', payload: { groupId } });
    await del('op-1', 'g1');
    await del('op-2', 'g1'); // the same transaction as op-1
    await del('op-3', 'g2'); // unrelated
    const client = fakeClient({
      '/v1/transactions/g1': async () => {
        throw new FF3RequestError(422, '{"message":"Nope."}');
      },
      '/v1/transactions/g2': async () => ({}),
    });

    const result = await replayOutbox(db as any, client as any);

    expect(result.failedAt).toBe('op-1');
    expect(result.succeeded).toEqual(['op-3']);
    const statuses = Object.fromEntries(
      (await db.select().from(outboxOperations)).map((r) => [r.id, r.status]),
    );
    expect(statuses).toEqual({ 'op-1': 'failed', 'op-2': 'pending' });
  });

  it('flags a stale updated_at as a conflict instead of overwriting', async () => {
    const db = createTestDb();
    await db.insert(cachedTransactions).values({
      groupId: 'g1',
      journalId: 'j1',
      type: 'withdrawal',
      date: '2026-09-01',
      amount: '10.00',
      currencyCode: 'PLN',
      description: 'test',
      tagsJson: '[]',
      updatedAt: '2026-09-01T00:00:00Z',
      syncedAt: '2026-09-01T00:00:00Z',
    });
    await enqueueOperation(db, {
      id: 'op-1',
      kind: 'update_transaction',
      payload: {
        groupId: 'g1',
        transactionJournalId: 'j1',
        expectedUpdatedAt: '2026-08-01T00:00:00Z',
        changes: { amount: '20.00' },
      },
    });

    const conflicts: unknown[] = [];
    const client = fakeClient({ '/v1/transactions': async () => ({}) });
    const result = await replayOutbox(db as any, client as any, {
      onConflict: (op, serverUpdatedAt) => conflicts.push({ op, serverUpdatedAt }),
    });

    expect(result.conflicted).toEqual(['op-1']);
    expect(conflicts).toHaveLength(1);
  });

  it('writes ff3GroupId from the create response and transitions the inbox item to synced (defect (3))', async () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    await db.insert(inboxItems).values({
      id: 'item-1',
      kind: 'manual_entry',
      state: 'confirmed',
      draftJson: '{}',
      createdAt: now,
      updatedAt: now,
    });
    await enqueueOperation(db, {
      id: 'op-1',
      inboxItemId: 'item-1',
      kind: 'create_transaction',
      payload: { clientId: 'c1', splits: [] },
    });

    const client = fakeClient({
      '/v1/transactions': async () => ({
        data: { id: 'g1', attributes: { transactions: [{ transaction_journal_id: 'j1' }] } },
      }),
    });
    await replayOutbox(db as any, client as any);

    const item = (await db.select().from(inboxItems).where(eq(inboxItems.id, 'item-1')))[0]!;
    expect(item.ff3GroupId).toBe('g1');
    expect(item.state).toBe('synced');
  });

  it('enqueues attach_receipt exactly once, even when the create is retried after a prior failure', async () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    await db.insert(inboxItems).values({
      id: 'item-1',
      kind: 'manual_entry',
      state: 'confirmed',
      draftJson: '{}',
      receiptImagePath: 'file:///receipt.jpg',
      createdAt: now,
      updatedAt: now,
    });
    await enqueueOperation(db, {
      id: 'op-1',
      inboxItemId: 'item-1',
      kind: 'create_transaction',
      payload: { clientId: 'c1', splits: [] },
    });

    let attempt = 0;
    const client = {
      request: jest.fn(async (path: string) => {
        if (path === '/v1/transactions') {
          attempt += 1;
          if (attempt === 1) throw new Error('network down');
          return {
            data: { id: 'g1', attributes: { transactions: [{ transaction_journal_id: 'j1' }] } },
          };
        }
        throw new Error(`no handler for ${path}`);
      }),
    };

    const first = await replayOutbox(db as any, client as any);
    expect(first.failedAt).toBe('op-1');

    await db.update(outboxOperations).set({ nextAttemptAt: null }); // the backoff has passed
    const second = await replayOutbox(db as any, client as any);
    expect(second.succeeded).toEqual(['op-1']);

    const attachOps = (await db.select().from(outboxOperations)).filter(
      (op) => op.kind === 'attach_receipt',
    );
    expect(attachOps).toHaveLength(1);
  });

  it("update_account re-reads the account at replay and keeps the server's other note lines", async () => {
    const db = createTestDb();
    await enqueueOperation(db, {
      id: 'op-1',
      kind: 'update_account',
      payload: { accountId: 'acc-1', setEnvelopeMarker: true },
    });

    let putBody: string | undefined;
    const client = {
      request: jest.fn(async (path: string, init?: RequestInit) => {
        if (path === '/v1/accounts/acc-1' && (!init || init.method === undefined)) {
          // GET: the server's notes changed since the checkbox was ticked (someone edited it in the web UI)
          return {
            data: {
              id: 'acc-1',
              attributes: {
                name: 'Cash',
                type: 'asset',
                currency_code: 'PLN',
                active: true,
                notes: 'Edited in the web UI just now',
              },
            },
          };
        }
        if (path === '/v1/accounts/acc-1' && init?.method === 'PUT') {
          putBody = init.body as string;
          return {};
        }
        throw new Error(`no handler for ${path} ${init?.method}`);
      }),
    };

    const result = await replayOutbox(db as any, client as any);

    expect(result.succeeded).toEqual(['op-1']);
    expect(JSON.parse(putBody!)).toEqual({
      notes: 'Edited in the web UI just now\nmmyway-envelope',
    });
  });

  it('update_account sends only the active flag when that is all it carries', async () => {
    const db = createTestDb();
    await enqueueOperation(db, {
      id: 'op-1',
      kind: 'update_account',
      payload: { accountId: 'acc-1', active: false },
    });
    const client = fakeClient({ '/v1/accounts/acc-1': async () => ({}) });
    await replayOutbox(db as any, client as any);
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request.mock.calls[0]).toEqual([
      '/v1/accounts/acc-1',
      { method: 'PUT', body: JSON.stringify({ active: false }) },
    ]);
  });

  it('update_account sends a new position (Reorder) to FF3', async () => {
    const db = createTestDb();
    await enqueueOperation(db, {
      id: 'op-1',
      kind: 'update_account',
      payload: { accountId: 'acc-1', order: 3 },
    });
    const client = fakeClient({ '/v1/accounts/acc-1': async () => ({}) });
    await replayOutbox(db as any, client as any);
    expect(
      JSON.parse(
        (client.request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      ),
    ).toEqual({ order: 3 });
  });

  it("update_account sends the account page's fields under FF3's names", async () => {
    const db = createTestDb();
    await enqueueOperation(db, {
      id: 'op-1',
      kind: 'update_account',
      payload: {
        accountId: 'acc-1',
        edit: {
          name: 'Wallet',
          includeNetWorth: false,
          openingBalance: '-20.5',
          openingBalanceDate: '2026-01-01',
          virtualBalance: null,
        },
      },
    });
    const client = fakeClient({ '/v1/accounts/acc-1': async () => ({}) });
    await replayOutbox(db as any, client as any);
    expect(
      JSON.parse(
        (client.request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      ),
    ).toEqual({
      name: 'Wallet',
      include_net_worth: false,
      opening_balance: '-20.5',
      opening_balance_date: '2026-01-01',
      virtual_balance: null,
    });
  });
});
