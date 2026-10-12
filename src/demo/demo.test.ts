import { readStoredCredentials } from '../api/ff3/auth';
import { createTestDb } from '../db/testDb';
import {
  bucketObjects,
  cachedTransactions,
  inboxItems,
  outboxOperations,
  plannedObjects,
  referenceAccounts,
} from '../db/schema';
import { enqueueOperation } from '../sync/outbox';
import { getDemoMode, leaveDemo, startDemo } from './demo';

jest.mock('../api/ff3/auth', () => ({ readStoredCredentials: jest.fn() }));

const T = '2026-01-01T00:00:00Z';
const TODAY = new Date(2026, 9, 12, 12);

/** What the user had on the phone before trying the demo: one synced account and transaction. */
async function withUsersData() {
  const db = createTestDb() as any;
  await db
    .insert(referenceAccounts)
    .values({ id: 'real-1', name: 'My wallet', type: 'asset', currencyCode: 'PLN', syncedAt: T });
  await db.insert(cachedTransactions).values({
    groupId: 'real-g',
    journalId: 'real-j',
    type: 'withdrawal',
    date: T,
    amount: '1.00',
    currencyCode: 'PLN',
    description: 'Mine',
    updatedAt: T,
    syncedAt: T,
  });
  return db;
}

beforeEach(() => {
  jest.clearAllMocks();
  (readStoredCredentials as jest.Mock).mockResolvedValue(null);
});

describe('startDemo', () => {
  it('refuses while signed in, and leaves the real data alone', async () => {
    const db = await withUsersData();
    (readStoredCredentials as jest.Mock).mockResolvedValue({ host: 'https://ff3', apiToken: 't' });

    expect(await startDemo(db, TODAY)).toEqual({ status: 'signed_in' });
    expect(await getDemoMode(db)).toBe(false);
    expect((await db.select().from(referenceAccounts)).map((a: { id: string }) => a.id)).toEqual([
      'real-1',
    ]);
    expect(await db.select().from(cachedTransactions)).toHaveLength(1);
  });

  it("replaces what was on the phone with the demo's sample data and turns demo mode on", async () => {
    const db = await withUsersData();

    expect(await startDemo(db, TODAY)).toEqual({ status: 'started' });
    expect(await getDemoMode(db)).toBe(true);
    const accounts = await db.select().from(referenceAccounts);
    expect(accounts).toHaveLength(9);
    expect(accounts.map((a: { id: string }) => a.id)).not.toContain('real-1');
    expect(await db.select().from(cachedTransactions)).toHaveLength(18);
    expect(await db.select().from(plannedObjects)).toHaveLength(1);
    expect(await db.select().from(bucketObjects)).toHaveLength(2);
  });
});

describe('startDemo with something real still on the phone', () => {
  it('refuses while a change is queued, so leaving the demo later cannot delete it', async () => {
    const db = await withUsersData();
    await enqueueOperation(db, {
      id: 'op-1',
      kind: 'update_budget',
      payload: { budgetId: '1', name: 'Mine' },
    });

    expect(await startDemo(db, TODAY)).toEqual({ status: 'has_data' });
    expect(await getDemoMode(db)).toBe(false);
    expect(await db.select().from(outboxOperations)).toHaveLength(1);
    expect(await db.select().from(cachedTransactions)).toHaveLength(1);
  });
});

describe('leaveDemo', () => {
  it('deletes the sample data, every queued operation and every inbox item, and turns demo mode off', async () => {
    const db = createTestDb() as any;
    await startDemo(db, TODAY);
    await enqueueOperation(db, {
      id: 'op',
      kind: 'update_account',
      payload: { accountId: 'demo-1', active: false },
    });
    await db.insert(inboxItems).values({
      id: 'draft',
      kind: 'manual_entry',
      state: 'captured',
      draftJson: '{}',
      createdAt: T,
      updatedAt: T,
    });

    await leaveDemo(db);

    for (const table of [
      referenceAccounts,
      cachedTransactions,
      plannedObjects,
      bucketObjects,
      outboxOperations,
      inboxItems,
    ]) {
      expect(await db.select().from(table)).toEqual([]);
    }
    expect(await getDemoMode(db)).toBe(false);
  });
});
