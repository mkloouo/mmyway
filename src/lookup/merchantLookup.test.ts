import { createTestDb } from '../db/testDb';
import { cachedTransactions } from '../db/schema';
import { buildMerchantLookup } from './merchantLookup';

async function seed() {
  const db = createTestDb();
  const base = { journalId: 'j', date: '2026-09-01', amount: '1', currencyCode: 'PLN', description: 'd', tagsJson: '[]', updatedAt: 'u', syncedAt: 's' };
  await db.insert(cachedTransactions).values([
    { ...base, groupId: 'w1', type: 'withdrawal', sourceName: 'Cash · Base', destinationName: 'Żabka', categoryName: 'Groceries' },
    { ...base, groupId: 'w2', type: 'withdrawal', sourceName: 'Cash · Base', destinationName: 'Żabka', categoryName: 'Groceries' },
    { ...base, groupId: 'd1', type: 'deposit', sourceName: 'Employer', destinationName: 'Revolut' },
    { ...base, groupId: 't1', type: 'transfer', sourceName: 'Cash · Case · PLN', destinationName: 'Cash · Base' },
  ]);
  return db;
}

describe('buildMerchantLookup', () => {
  it('never lists a transfer end as a payee', async () => {
    const lookup = await buildMerchantLookup(await seed() as any);
    expect([...lookup.values()].map((h) => h.displayName).sort()).toEqual(['Employer', 'Żabka']);
  });
  it('narrows to payees or payers by type', async () => {
    const db = await seed();
    expect([...(await buildMerchantLookup(db as any, { type: 'withdrawal' })).values()].map((h) => h.displayName)).toEqual(['Żabka']);
    expect([...(await buildMerchantLookup(db as any, { type: 'deposit' })).values()].map((h) => h.displayName)).toEqual(['Employer']);
  });
  it('keeps the top category and account per payee', async () => {
    const lookup = await buildMerchantLookup(await seed() as any, { type: 'withdrawal' });
    expect(lookup.get('zabka')).toMatchObject({ topCategory: 'Groceries', topAccountName: 'Cash · Base', occurrences: 2 });
  });
});
