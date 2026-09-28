import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { cachedTransactions, referenceAccounts } from '../db/schema';
import { backfillCachedTransactions, cachedRowFromGroup } from './referenceData';
import { normkey } from '../lookup/normkey';

function split(extra: Record<string, unknown>) {
  return {
    transaction_journal_id: 'j1', type: 'withdrawal', date: '2026-09-27T10:00:00+02:00', amount: '10.00', currency_code: 'PLN',
    description: 'Groceries', source_name: 'Revolut', destination_name: 'Żabka', source_id: 1, destination_id: 9,
    category_name: 'Food', budget_id: '3', budget_name: 'Monthly', tags: [], ...extra,
  };
}

function group(splits: Record<string, unknown>[], attrs: Record<string, unknown> = {}) {
  return { id: 'g1', type: 'transactions', attributes: { updated_at: 'u1', transactions: splits, ...attrs } } as any;
}

describe('cachedRowFromGroup', () => {
  it('keeps the account and budget ids and the budget name', () => {
    const row = cachedRowFromGroup(group([split({})]), 's')!;
    expect(row).toMatchObject({ sourceId: '1', destinationId: '9', budgetId: '3', budgetName: 'Monthly', splitCount: 1, amount: '10.00' });
  });

  it('shows a split group as its total under the group title', () => {
    const row = cachedRowFromGroup(group([split({}), split({ transaction_journal_id: 'j2', amount: '2.55', description: 'Beer' })], { group_title: 'Weekly shop' }), 's')!;
    expect(row).toMatchObject({ amount: '12.55', description: 'Weekly shop', splitCount: 2, journalId: 'j1' });
    expect(row.searchKey).toContain('beer');
  });

  it('builds a search key that ignores case and Polish/Cyrillic diacritics', () => {
    const row = cachedRowFromGroup(group([split({ description: 'ŻABKA Polska' })]), 's')!;
    expect(row.searchKey).toContain(normkey('żabka'));
    expect(row.searchKey).toContain(normkey('Żabka'));
  });
});

describe('backfillCachedTransactions', () => {
  it('fills the search key and the account ids of rows cached before they existed', async () => {
    const db = createTestDb();
    await db.insert(referenceAccounts).values({ id: 'a1', name: 'Revolut', type: 'asset', currencyCode: 'PLN', syncedAt: 's' });
    await db.insert(cachedTransactions).values({
      groupId: 'old', journalId: 'j', type: 'withdrawal', date: '2026-01-01', amount: '1', currencyCode: 'PLN',
      description: 'Żabka', sourceName: 'Revolut', destinationName: 'Żabka', updatedAt: 'u', syncedAt: 's',
    });
    await backfillCachedTransactions(db as any);
    const [row] = await db.select().from(cachedTransactions).where(eq(cachedTransactions.groupId, 'old'));
    expect(row).toMatchObject({ sourceId: 'a1', destinationId: null });
    expect(row!.searchKey).toContain('zabka');
  });
});
