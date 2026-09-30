import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { clearInstanceData, isSameInstance, queuedOperationCount } from './instanceData';
import { enqueueOperation } from './outbox';
import { readDraft, writeDraft } from '../inbox/draftJson';
import type { Draft } from '../inbox/draft';
import {
  aliases,
  cachedTransactions,
  inboxItems,
  referenceAccounts,
  referenceBudgets,
  referenceCategories,
  referenceCurrencies,
} from '../db/schema';
import {
  getCashAccountId,
  setCashAccountId,
  getReconcileShortfallAccountId,
  setReconcileShortfallAccountId,
  getReconcileSurplusAccountId,
  setReconcileSurplusAccountId,
  setReconcileCategoryName,
  getReconcileCategoryName,
  getDefaultSourceAccountId,
  setDefaultSourceAccountId,
  getLastSyncedAt,
  setLastSyncedAt,
  getFf3ActiveHost,
  setFf3ActiveHost,
  getBalancesStale,
  setBalancesStale,
  getLocalModelName,
  setLocalModelName,
} from '../settings/appSettings';

const T = '2026-01-01T00:00:00Z';

describe('isSameInstance', () => {
  it('matches a stored address regardless of trailing slash or case', () => {
    expect(
      isSameInstance(['https://ff3.example.com', 'http://100.64.0.1'], 'HTTPS://ff3.example.com/ '),
    ).toBe(true);
  });

  it('treats any other address as another instance', () => {
    expect(isSameInstance(['https://ff3.example.com'], 'https://other.example.com')).toBe(false);
    expect(isSameInstance([], 'https://ff3.example.com')).toBe(false);
  });
});

describe('queuedOperationCount', () => {
  it('counts every queued operation, whatever its kind', async () => {
    const db = createTestDb() as any;
    expect(await queuedOperationCount(db)).toBe(0);
    await enqueueOperation(db, {
      id: 'c',
      kind: 'create_transaction',
      payload: { clientId: 'c', splits: [] },
    });
    await enqueueOperation(db, {
      id: 'a',
      kind: 'update_account',
      payload: { accountId: 'a1', active: false },
    });
    expect(await queuedOperationCount(db)).toBe(2);
  });
});

describe('clearInstanceData', () => {
  it("removes what was synced from the instance and keeps the user's drafts, aliases and other preferences", async () => {
    const db = createTestDb() as any;
    await db
      .insert(referenceAccounts)
      .values({ id: 'a1', name: 'Wallet', type: 'asset', currencyCode: 'PLN', syncedAt: T });
    await db.insert(referenceCategories).values({ id: 'c1', name: 'Food', syncedAt: T });
    await db.insert(referenceBudgets).values({ id: 'b1', name: 'Groceries', syncedAt: T });
    await db
      .insert(referenceCurrencies)
      .values({ code: 'PLN', symbol: 'zł', decimalPlaces: 2, syncedAt: T });
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
    await db.insert(inboxItems).values([
      {
        id: 'draft',
        kind: 'manual_entry',
        state: 'captured',
        draftJson: '{}',
        createdAt: T,
        updatedAt: T,
      },
      {
        id: 'review',
        kind: 'recurring_review',
        state: 'confirmed',
        draftJson: '{}',
        createdAt: T,
        updatedAt: T,
      },
    ]);
    await db.insert(aliases).values({
      id: 'al',
      kind: 'payee',
      normalizedKey: 'k',
      rawInput: 'k',
      targetName: 'K',
      createdAt: T,
    });
    await setLastSyncedAt(db, T);
    await setFf3ActiveHost(db, 'https://ff3.example.com');
    await setBalancesStale(db, true);
    await setDefaultSourceAccountId(db, 'a1');
    await setCashAccountId(db, 'a1');
    await setReconcileShortfallAccountId(db, 'a2');
    await setReconcileSurplusAccountId(db, 'a3');
    await setReconcileCategoryName(db, 'Cash count');
    await setLocalModelName(db, 'qwen');

    await clearInstanceData(db);

    for (const table of [
      referenceAccounts,
      referenceCategories,
      referenceBudgets,
      referenceCurrencies,
      cachedTransactions,
    ]) {
      expect(await db.select().from(table)).toEqual([]);
    }
    expect((await db.select().from(inboxItems)).map((i: { id: string }) => i.id)).toEqual([
      'draft',
    ]);
    expect(await db.select().from(aliases)).toHaveLength(1);
    expect(await getLastSyncedAt(db)).toBeNull();
    expect(await getFf3ActiveHost(db)).toBeNull();
    expect(await getBalancesStale(db)).toBe(false);
    // Settings that name an account by id go with the accounts; the rest are the user's.
    expect(await getDefaultSourceAccountId(db)).toBeNull();
    expect(await getCashAccountId(db)).toBeNull();
    expect(await getReconcileShortfallAccountId(db)).toBeNull();
    expect(await getReconcileSurplusAccountId(db)).toBeNull();
    expect(await getReconcileCategoryName(db)).toBe('Cash count');
    expect(await getLocalModelName(db)).toBe('qwen');
  });

  it('takes the ids out of drafts and aliases and keeps the names they resolve again by', async () => {
    const db = createTestDb() as any;
    const draft: Draft = {
      type: 'withdrawal',
      amount: '5.00',
      currencyCode: 'PLN',
      date: T,
      description: 'Milk',
      sourceName: 'Wallet',
      sourceId: '3',
      destinationName: 'Żabka',
      destinationId: '7',
      isNewPayee: false,
      categoryName: 'Food',
      budgetId: '2',
      extraSplits: [
        {
          amount: '1.00',
          description: 'Bag',
          payeeName: 'Żabka',
          payeeId: '7',
          budgetId: '2',
          isNewPayee: false,
        },
      ],
    };
    const row = (id: string, state: string) => ({
      id,
      kind: 'manual_entry',
      state,
      draftJson: writeDraft(draft),
      createdAt: T,
      updatedAt: T,
    });
    await db
      .insert(inboxItems)
      .values([row('open', 'captured'), row('failed', 'error'), row('done', 'synced')]);
    await db.insert(aliases).values({
      id: 'al',
      kind: 'payee',
      normalizedKey: 'zabka',
      rawInput: 'zabka',
      targetId: '7',
      targetName: 'Żabka',
      createdAt: T,
    });

    await clearInstanceData(db);

    const read = async (id: string) =>
      readDraft((await db.select().from(inboxItems).where(eq(inboxItems.id, id)))[0].draftJson);
    for (const id of ['open', 'failed']) {
      const stripped = await read(id);
      expect(stripped).toMatchObject({
        sourceName: 'Wallet',
        destinationName: 'Żabka',
        categoryName: 'Food',
        extraSplits: [{ payeeName: 'Żabka' }],
      });
      expect(stripped).not.toHaveProperty('sourceId');
      expect(stripped).not.toHaveProperty('destinationId');
      expect(stripped).not.toHaveProperty('budgetId');
      expect(stripped.extraSplits![0]).not.toHaveProperty('payeeId');
      expect(stripped.extraSplits![0]).not.toHaveProperty('budgetId');
    }
    // History of what was sent isn't a draft anyone can confirm again.
    expect(await read('done')).toMatchObject({ sourceId: '3', destinationId: '7' });
    const [alias] = await db.select().from(aliases);
    expect(alias).toMatchObject({ targetId: null, targetName: 'Żabka' });
  });
});
