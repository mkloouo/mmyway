import { createTestDb } from '../db/testDb';
import { cachedTransactions, referenceAccounts } from '../db/schema';
import { buildMerchantLookup } from './merchantLookup';

async function seed() {
  const db = createTestDb();
  const base = {
    journalId: 'j',
    date: '2026-09-01',
    amount: '1',
    currencyCode: 'PLN',
    description: 'd',
    tagsJson: '[]',
    updatedAt: 'u',
    syncedAt: 's',
  };
  await db.insert(cachedTransactions).values([
    {
      ...base,
      groupId: 'w1',
      type: 'withdrawal',
      sourceName: 'Cash · Base',
      destinationName: 'Żabka',
      categoryName: 'Groceries',
    },
    {
      ...base,
      groupId: 'w2',
      type: 'withdrawal',
      sourceName: 'Cash · Base',
      destinationName: 'Żabka',
      categoryName: 'Groceries',
    },
    { ...base, groupId: 'd1', type: 'deposit', sourceName: 'Employer', destinationName: 'Revolut' },
    {
      ...base,
      groupId: 't1',
      type: 'transfer',
      sourceName: 'Cash · Case · PLN',
      destinationName: 'Cash · Base',
    },
  ]);
  return db;
}

describe('buildMerchantLookup', () => {
  it('never lists a transfer end as a payee', async () => {
    const lookup = await buildMerchantLookup((await seed()) as any);
    expect([...lookup.values()].map((h) => h.displayName).sort()).toEqual(['Employer', 'Żabka']);
  });
  it('narrows to payees or payers by type', async () => {
    const db = await seed();
    expect(
      [...(await buildMerchantLookup(db as any, { type: 'withdrawal' })).values()].map(
        (h) => h.displayName,
      ),
    ).toEqual(['Żabka']);
    expect(
      [...(await buildMerchantLookup(db as any, { type: 'deposit' })).values()].map(
        (h) => h.displayName,
      ),
    ).toEqual(['Employer']);
  });
  it('keeps the top category and account per payee', async () => {
    const lookup = await buildMerchantLookup((await seed()) as any, { type: 'withdrawal' });
    expect(lookup.get('zabka')).toMatchObject({
      topCategory: 'Groceries',
      topAccountName: 'Cash · Base',
      occurrences: 2,
    });
  });

  it('drops a merchant name FF3 no longer has as a live expense account (renamed/merged there), once accounts are synced', async () => {
    const db = await seed();
    // A distinct syncedAt per test: the lookup memoizes on count + max(syncedAt), and two tests
    // inserting one row each with the same timestamp would otherwise collide on that signature.
    await db.insert(referenceAccounts).values({
      id: 'a1',
      name: 'Biedronka',
      type: 'expense',
      currencyCode: 'PLN',
      syncedAt: 'ra-1',
    });
    const names = [...(await buildMerchantLookup(db as any, { type: 'withdrawal' })).values()].map(
      (h) => h.displayName,
    );
    expect(names).toEqual([]); // "Żabka" isn't a live expense account in this seed
  });

  it('keeps a merchant whose name matches a live expense account', async () => {
    const db = await seed();
    await db.insert(referenceAccounts).values({
      id: 'a1',
      name: 'Żabka',
      type: 'expense',
      currencyCode: 'PLN',
      syncedAt: 'ra-2',
    });
    const names = [...(await buildMerchantLookup(db as any, { type: 'withdrawal' })).values()].map(
      (h) => h.displayName,
    );
    expect(names).toEqual(['Żabka']);
  });

  it('skips the live-account filter entirely before accounts have ever synced', async () => {
    // No referenceAccounts rows at all: don't wipe out history built from real transactions
    // just because the account sync hasn't run yet.
    const names = [
      ...(await buildMerchantLookup((await seed()) as any, { type: 'withdrawal' })).values(),
    ].map((h) => h.displayName);
    expect(names).toEqual(['Żabka']);
  });
});
