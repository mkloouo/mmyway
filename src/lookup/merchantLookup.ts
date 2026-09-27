import { cachedTransactions } from '../db/schema';
import { normkey } from './normkey';
import type { OutboxDb } from '../sync/outbox';

export interface MerchantHistory {
  merchantKey: string;
  displayName: string;
  topCategory: string | null;
  topAccountName: string | null;
  topBudgetName: string | null;
  occurrences: number;
}

function topOf(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

export async function buildMerchantLookup(db: OutboxDb): Promise<Map<string, MerchantHistory>> {
  const rows = await db.select().from(cachedTransactions);
  const byMerchant = new Map<string, { displayName: string; categories: Map<string, number>; accounts: Map<string, number>; budgets: Map<string, number>; count: number }>();

  for (const row of rows) {
    const merchant = row.type === 'withdrawal' ? row.destinationName : row.sourceName;
    if (!merchant) continue;
    const key = normkey(merchant);
    const entry = byMerchant.get(key) ?? { displayName: merchant, categories: new Map(), accounts: new Map(), budgets: new Map(), count: 0 };
    entry.count += 1;
    if (row.categoryName) entry.categories.set(row.categoryName, (entry.categories.get(row.categoryName) ?? 0) + 1);
    const accountName = row.type === 'withdrawal' ? row.sourceName : row.destinationName;
    if (accountName) entry.accounts.set(accountName, (entry.accounts.get(accountName) ?? 0) + 1);
    if (row.budgetName) entry.budgets.set(row.budgetName, (entry.budgets.get(row.budgetName) ?? 0) + 1);
    byMerchant.set(key, entry);
  }

  const result = new Map<string, MerchantHistory>();
  for (const [key, entry] of byMerchant) {
    result.set(key, {
      merchantKey: key,
      displayName: entry.displayName,
      topCategory: topOf(entry.categories),
      topAccountName: topOf(entry.accounts),
      topBudgetName: topOf(entry.budgets),
      occurrences: entry.count,
    });
  }
  return result;
}
