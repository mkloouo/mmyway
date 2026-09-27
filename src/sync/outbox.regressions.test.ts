// Each case reproduces a failure found in review (2026-09-27) against the old replay loop.
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { cachedTransactions, inboxItems, outboxOperations } from '../db/schema';
import { FF3RequestError } from '../api/ff3/client';
import { createManualEntry, confirmInboxItem, undoConfirm } from '../inbox/createManualEntry';
import { enqueueOperation, internalReferenceFor, recoverInFlight, replayOutbox } from './outbox';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

function group(id: string, extra: { internal_reference?: string; updated_at?: string } = {}) {
  return {
    id,
    attributes: {
      updated_at: extra.updated_at,
      transactions: [{ transaction_journal_id: `j-${id}`, internal_reference: extra.internal_reference }],
    },
  };
}

async function confirmedEntry(db: ReturnType<typeof createTestDb>, description: string) {
  const { inboxItemId } = await createManualEntry(db as any, {
    type: 'withdrawal', amount: '1', currencyCode: 'PLN', date: '2026-09-27T10:00:00Z', description,
    merchantRawInput: description, forceNewPayee: true, sourceId: '1',
  });
  const confirm = await confirmInboxItem(db as any, inboxItemId);
  return { inboxItemId, confirm };
}

describe('create idempotency', () => {
  it('sends the client id as internal_reference, not as a group title', async () => {
    const db = createTestDb();
    await enqueueOperation(db, { id: 'op-1', kind: 'create_transaction', payload: { clientId: 'c1', splits: [{ description: 'x' } as any] } });
    const client = { request: jest.fn(async () => ({ data: group('g1') })) };
    await replayOutbox(db as any, client as any);
    const body = JSON.parse((client.request.mock.calls[0] as any)[1].body);
    expect(body.transactions[0].internal_reference).toBe('mmyway:c1');
    expect(body.group_title).toBeUndefined();
  });

  it('a create that landed but lost its response is recorded as synced on retry, and the queue moves on', async () => {
    const db = createTestDb();
    const { inboxItemId } = await confirmedEntry(db, 'lost response');
    await enqueueOperation(db, { id: 'next', kind: 'update_account', payload: { accountId: 'a', active: true } });

    const reference = internalReferenceFor(inboxItemId);
    let posts = 0;
    const client = {
      request: jest.fn(async (path: string, init?: RequestInit) => {
        if (path === '/v1/transactions' && init?.method === 'POST') {
          posts += 1;
          if (posts === 1) throw new TypeError('Network request failed'); // server committed it
          throw new FF3RequestError(422, '{"message":"Duplicate of transaction #77."}');
        }
        if (path === '/v1/transactions/77') return { data: group('77', { internal_reference: reference }) };
        return {};
      }),
    };

    await replayOutbox(db as any, client as any);
    const second = await replayOutbox(db as any, client as any);

    expect(second.failedAt).toBeNull();
    expect(await db.select().from(outboxOperations)).toHaveLength(0);
    const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
    expect(item).toMatchObject({ state: 'synced', ff3GroupId: '77' });
  });

  it('a duplicate of someone else\'s transaction stays a failure', async () => {
    const db = createTestDb();
    await confirmedEntry(db, 'real duplicate');
    const client = {
      request: jest.fn(async (path: string, init?: RequestInit) => {
        if (init?.method === 'POST') throw new FF3RequestError(422, 'Duplicate of transaction #5.');
        if (path === '/v1/transactions/5') return { data: group('5', { internal_reference: 'something-else' }) };
        throw new FF3RequestError(404, '');
      }),
    };
    const result = await replayOutbox(db as any, client as any);
    expect(result.failedAt).not.toBeNull();
  });
});

describe('claiming', () => {
  it('Undo during an in-flight sync is honoured: the undone op is not sent', async () => {
    const db = createTestDb();
    await confirmedEntry(db, 'a');
    const b = await confirmedEntry(db, 'b');

    const gate = deferred();
    let posts = 0;
    const client = {
      request: jest.fn(async () => {
        posts += 1;
        if (posts === 1) await gate.promise;
        return { data: group(`g${posts}`) };
      }),
    };
    const replay = replayOutbox(db as any, client as any);
    await new Promise((r) => setTimeout(r, 10)); // replay is waiting on op A's POST
    expect(await undoConfirm(db as any, b.inboxItemId, b.confirm)).toBe('undone');
    gate.resolve();
    await replay;

    expect(posts).toBe(1);
    const [bRow] = await db.select().from(inboxItems).where(eq(inboxItems.id, b.inboxItemId));
    expect(bRow?.state).toBe('captured');
  });

  it('two concurrent replays never send the same op twice', async () => {
    const db = createTestDb();
    await enqueueOperation(db, { id: 'op-1', kind: 'create_transaction', payload: { clientId: 'c1', splits: [] } });
    const client = { request: jest.fn(async () => { await new Promise((r) => setTimeout(r, 5)); return { data: group('g1') }; }) };
    await Promise.all([replayOutbox(db as any, client as any), replayOutbox(db as any, client as any)]);
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('an op left in_flight by a killed process is retried after recovery', async () => {
    const db = createTestDb();
    await enqueueOperation(db, { id: 'op-1', kind: 'create_transaction', payload: { clientId: 'c1', splits: [] } });
    await db.update(outboxOperations).set({ status: 'in_flight' });
    await recoverInFlight(db as any);
    const client = { request: jest.fn(async () => ({ data: group('g1') })) };
    expect((await replayOutbox(db as any, client as any)).succeeded).toEqual(['op-1']);
  });

  it('two concurrent enqueues get distinct, ordered sequence numbers', async () => {
    const db = createTestDb();
    await Promise.all([
      enqueueOperation(db, { id: 'x', kind: 'create_transaction', payload: {} }),
      enqueueOperation(db, { id: 'y', kind: 'create_transaction', payload: {} }),
    ]);
    const rows = await db.select().from(outboxOperations);
    expect(rows.map((r) => r.sequence).sort()).toEqual([1, 2]);
  });
});

describe('edits and deletes', () => {
  const cached = { groupId: 'g1', journalId: 'j1', type: 'withdrawal', date: '2026-01-01', amount: '10.00', currencyCode: 'PLN', description: 't', tagsJson: '[]', updatedAt: 'v1', syncedAt: 's' };

  it('detects a server-side edit the cache could not see (outside the catch-up window)', async () => {
    const db = createTestDb();
    await db.insert(cachedTransactions).values(cached);
    await enqueueOperation(db, { id: 'op-1', kind: 'update_transaction', payload: { groupId: 'g1', transactionJournalId: 'j1', expectedUpdatedAt: 'v1', changes: { amount: '20.00' } } });
    const client = {
      request: jest.fn(async (_path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') throw new Error('must not overwrite');
        return { data: group('g1', { updated_at: 'v2-edited-in-web-ui' }) };
      }),
    };
    const result = await replayOutbox(db as any, client as any);
    expect(result.conflicted).toEqual(['op-1']);
  });

  it('a second offline edit of the same transaction does not conflict with the first', async () => {
    const db = createTestDb();
    await db.insert(cachedTransactions).values(cached);
    const edit = (id: string, amount: string) => enqueueOperation(db, { id, kind: 'update_transaction', payload: { groupId: 'g1', transactionJournalId: 'j1', expectedUpdatedAt: 'v1', changes: { amount } } });
    await edit('op-1', '20.00');
    await edit('op-2', '30.00');

    let server = 'v1';
    const client = {
      request: jest.fn(async (_path: string, init?: RequestInit) => {
        if (init?.method === 'PUT') server = `v${Number(server.slice(1)) + 1}`;
        return { data: group('g1', { updated_at: server }) };
      }),
    };
    const result = await replayOutbox(db as any, client as any);
    expect(result).toMatchObject({ succeeded: ['op-1', 'op-2'], conflicted: [], failedAt: null });
  });

  it('a delete removes the cached row, and a delete of something already gone succeeds', async () => {
    const db = createTestDb();
    await db.insert(cachedTransactions).values(cached);
    await enqueueOperation(db, { id: 'op-1', kind: 'delete_transaction', payload: { groupId: 'g1', expectedUpdatedAt: 'v1' } });
    const client = { request: jest.fn(async () => { throw new FF3RequestError(404, ''); }) };
    const result = await replayOutbox(db as any, client as any);
    expect(result.succeeded).toEqual(['op-1']);
    expect(await db.select().from(cachedTransactions)).toHaveLength(0);
  });
});

describe('receipt upload', () => {
  it('a failed upload retries the upload alone, never creating a second attachment', async () => {
    jest.resetModules();
    jest.doMock('expo-file-system', () => ({
      File: class { exists = true; constructor(public uri: string) {} async arrayBuffer() { return new ArrayBuffer(1); } },
    }));
    // A fresh module registry, so outbox's lazy require picks up the doMock above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { replayOutbox: replay, enqueueOperation: enqueue } = require('./outbox');
    const db = createTestDb();
    await enqueue(db, { id: 'op-1', kind: 'attach_receipt', payload: { transactionJournalId: 'j1', receiptImagePath: 'file:///data/receipts/r.png' } });

    let uploads = 0;
    const client = {
      request: jest.fn(async (path: string) => {
        if (path === '/v1/attachments') return { data: { id: 'att-1' } };
        uploads += 1;
        if (uploads === 1) throw new TypeError('Network request failed');
        return undefined;
      }),
    };
    await replay(db, client);
    await replay(db, client);

    const creates = client.request.mock.calls.filter(([p]: [string]) => p === '/v1/attachments');
    expect(creates).toHaveLength(1);
    expect(JSON.parse((creates[0] as any)[1].body).filename).toBe('receipt.png');
    expect(await db.select().from(outboxOperations)).toHaveLength(0);
    jest.dontMock('expo-file-system');
  });
});

describe('error text', () => {
  it('shows FF3 messages, not raw JSON', () => {
    const { describeFF3Error: d } = jest.requireActual('./outbox');
    expect(d(new FF3RequestError(401, '{"message":"Unauthenticated.","exception":"AuthenticationException"}'))).toBe('Unauthenticated. (401)');
    expect(d(new FF3RequestError(422, '{"message":"The given data was invalid.","errors":{"transactions.0.amount":["The amount must be more than zero."]}}')))
      .toBe('The given data was invalid. — The amount must be more than zero. (422)');
    expect(d(new FF3RequestError(502, '<html>Bad gateway</html>'))).toBe('Firefly III answered 502');
  });
});

describe('conflict details', () => {
  it('stores the server\'s current copy so the conflict screen can compare it', async () => {
    const db = createTestDb();
    await db.insert(cachedTransactions).values({ groupId: 'g1', journalId: 'j1', type: 'withdrawal', date: '2026-01-01', amount: '10.00', currencyCode: 'PLN', description: 'old', tagsJson: '[]', updatedAt: 'v1', syncedAt: 's' });
    await enqueueOperation(db, { id: 'op-1', kind: 'update_transaction', payload: { groupId: 'g1', transactionJournalId: 'j1', expectedUpdatedAt: 'v1', changes: { notes: 'mine' } } });
    const serverGroup = {
      id: 'g1',
      attributes: {
        updated_at: 'v2',
        transactions: [{ transaction_journal_id: 'j1', type: 'withdrawal', date: '2026-01-01', amount: '15.000000000000', currency_code: 'PLN', description: 'edited in web', notes: 'theirs', tags: [] }],
      },
    };
    const client = { request: jest.fn(async () => ({ data: serverGroup })) };
    await replayOutbox(db as any, client as any);
    const [row] = await db.select().from(cachedTransactions);
    expect(row).toMatchObject({ updatedAt: 'v2', amount: '15.000000000000', description: 'edited in web', notes: 'theirs' });
  });
});

describe('receipt photo cleanup', () => {
  it('drops the device copy only for receipts synced over 30 days ago with nothing left to upload', async () => {
    const { pruneUploadedReceiptImages } = jest.requireActual('./outbox');
    const db = createTestDb();
    const base = { kind: 'receipt', draftJson: '{}', createdAt: 'c' };
    await db.insert(inboxItems).values([
      { ...base, id: 'old', state: 'synced', receiptImagePath: 'file:///x/receipts/old.jpg', updatedAt: '2026-08-01T00:00:00Z' },
      { ...base, id: 'recent', state: 'synced', receiptImagePath: 'file:///x/receipts/recent.jpg', updatedAt: '2026-09-20T00:00:00Z' },
      { ...base, id: 'old-queued', state: 'synced', receiptImagePath: 'file:///x/receipts/q.jpg', updatedAt: '2026-08-01T00:00:00Z' },
    ]);
    await enqueueOperation(db, { id: 'up', inboxItemId: 'old-queued', kind: 'attach_receipt', payload: {} });

    await pruneUploadedReceiptImages(db, new Date('2026-09-27T00:00:00Z'));

    const paths = Object.fromEntries((await db.select().from(inboxItems)).map((i) => [i.id, i.receiptImagePath]));
    expect(paths).toEqual({ old: null, recent: 'file:///x/receipts/recent.jpg', 'old-queued': 'file:///x/receipts/q.jpg' });
  });
});

describe('references deleted in FF3', () => {
  it('hands a create back to the Inbox when its category is gone, and keeps the queue moving', async () => {
    const db = createTestDb();
    const { referenceCategories, referenceAccounts } = jest.requireActual('../db/schema');
    await db.insert(referenceAccounts).values({ id: '1', name: 'Cash', type: 'asset', currencyCode: 'PLN', active: true, syncedAt: 's' });
    await db.insert(referenceCategories).values({ id: 'c1', name: 'Groceries', syncedAt: 's' });
    const { inboxItemId } = await createManualEntry(db as any, {
      type: 'withdrawal', amount: '1', currencyCode: 'PLN', date: '2026-09-27T10:00:00Z', description: 'x',
      merchantRawInput: 'x', forceNewPayee: true, sourceId: '1', categoryName: 'Deleted in web',
    });
    await confirmInboxItem(db as any, inboxItemId);
    await enqueueOperation(db, { id: 'next', kind: 'update_account', payload: { accountId: '1', active: true } });
    const client = { request: jest.fn(async () => ({})) };

    const result = await replayOutbox(db as any, client as any);

    expect(result.failedAt).toBeNull();
    expect(result.succeeded).toEqual(['next']);
    const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
    expect(item).toMatchObject({ state: 'captured' });
    expect(item?.errorMessage).toContain('"Deleted in web" no longer exists');
    expect(client.request).toHaveBeenCalledTimes(1); // only the account update was sent
  });
});
