import { createTestDb } from '../db/testDb';
import { cachedTransactions, referenceAccounts } from '../db/schema';
import { readStoredCredentials, signIn } from '../api/ff3/auth';
import { readHosts } from '../api/ff3/hosts';
import { enqueueOperation } from '../sync/outbox';
import { connectFailureText, connectToInstance } from './connectInstance';

// What ran, in order: the sign-in and the clearing must both happen while syncs are paused, or a
// running sync would refill the tables the clearing just emptied.
const mockEvents: string[] = [];

jest.mock('../api/ff3/auth', () => ({ signIn: jest.fn(), readStoredCredentials: jest.fn() }));
jest.mock('../api/ff3/hosts', () => ({ readHosts: jest.fn() }));
jest.mock('../sync/runSync', () => ({
  withSyncPaused: async (work: () => Promise<unknown>) => {
    mockEvents.push('pause');
    try {
      return await work();
    } finally {
      mockEvents.push('resume');
    }
  },
}));
jest.mock('../sync/instanceData', () => {
  const actual = jest.requireActual('../sync/instanceData');
  return {
    ...actual,
    clearInstanceData: async (db: unknown) => {
      mockEvents.push('clear');
      return actual.clearInstanceData(db);
    },
  };
});

const T = '2026-01-01T00:00:00Z';
const OK = { ok: true, client: {}, apiVersion: '6.3.2', defaultCurrencyCode: 'PLN' };

async function withSyncedData() {
  const db = createTestDb() as any;
  await db
    .insert(referenceAccounts)
    .values({ id: 'a1', name: 'Wallet', type: 'asset', currencyCode: 'PLN', syncedAt: T });
  await db.insert(cachedTransactions).values({
    groupId: 'g1',
    journalId: 'j1',
    type: 'withdrawal',
    date: T,
    amount: '1.00',
    currencyCode: 'PLN',
    description: 'x',
    updatedAt: T,
    syncedAt: T,
  });
  return db;
}

function signedInTo(host: string | null) {
  (readStoredCredentials as jest.Mock).mockResolvedValue(
    host ? { host, apiToken: 'old-token' } : null,
  );
  (readHosts as jest.Mock).mockResolvedValue(host ? [host] : []);
}

describe('connectToInstance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEvents.length = 0;
    (signIn as jest.Mock).mockImplementation(async () => {
      mockEvents.push('signIn');
      return OK;
    });
  });

  it('signs in when signed out, with nothing to clear', async () => {
    const db = await withSyncedData();
    signedInTo(null);

    expect(await connectToInstance(db, 'http://localhost:8080', 'tok')).toEqual({
      status: 'connected',
    });
    expect(signIn).toHaveBeenCalledWith('http://localhost:8080', 'tok');
    expect(await db.select().from(referenceAccounts)).toHaveLength(1);
    expect(mockEvents).toEqual(['pause', 'signIn', 'resume']);
  });

  it('keeps everything for a new token at the address already stored', async () => {
    const db = await withSyncedData();
    signedInTo('http://localhost:8080');
    await enqueueOperation(db, {
      id: 'op',
      kind: 'update_account',
      payload: { accountId: 'a1', active: false },
    });

    expect((await connectToInstance(db, 'http://localhost:8080/', 'new')).status).toBe('connected');
    expect(await db.select().from(cachedTransactions)).toHaveLength(1);
  });

  it("clears the old instance's synced data when signing in somewhere else", async () => {
    const db = await withSyncedData();
    signedInTo('http://localhost:8080');

    expect((await connectToInstance(db, 'http://localhost:8081', 'tok')).status).toBe('connected');
    expect(await db.select().from(referenceAccounts)).toEqual([]);
    expect(await db.select().from(cachedTransactions)).toEqual([]);
    expect(mockEvents).toEqual(['pause', 'signIn', 'clear', 'resume']);
  });

  it('refuses to switch while changes are queued, and does not even try to sign in', async () => {
    const db = await withSyncedData();
    signedInTo('http://localhost:8080');
    await enqueueOperation(db, {
      id: 'op',
      kind: 'update_account',
      payload: { accountId: 'a1', active: false },
    });

    expect(await connectToInstance(db, 'http://localhost:8081', 'tok')).toEqual({
      status: 'queued',
      count: 1,
    });
    expect(signIn).not.toHaveBeenCalled();
    expect(mockEvents).toEqual([]);
    expect(await db.select().from(referenceAccounts)).toHaveLength(1);
  });

  it('keeps the old data when the new instance turns the sign-in down', async () => {
    const db = await withSyncedData();
    signedInTo('http://localhost:8080');
    (signIn as jest.Mock).mockImplementation(async () => {
      mockEvents.push('signIn');
      return { ok: false, reason: 'invalid_api_key' };
    });

    expect(await connectToInstance(db, 'http://localhost:8081', 'bad')).toEqual({
      status: 'failed',
      reason: 'invalid_api_key',
    });
    expect(await db.select().from(cachedTransactions)).toHaveLength(1);
    expect(mockEvents).toEqual(['pause', 'signIn', 'resume']); // no clearing
  });
});

describe('connectFailureText', () => {
  it('says why a sign-in failed', () => {
    expect(connectFailureText({ status: 'failed', reason: 'invalid_api_key' })).toEqual({
      title: 'Sign-in failed',
      message: 'That token was rejected — check it was copied in full.',
    });
  });

  it('says a switch has to wait for the queue, with how much is in it', () => {
    const text = connectFailureText({ status: 'queued', count: 2 });
    expect(text.title).toBe("Can't switch Firefly III yet");
    expect(text.message).toContain('2');
  });
});
