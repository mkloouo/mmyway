import { sql } from 'drizzle-orm';
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

type Kind = 'withdrawal' | 'deposit';
type Bucket = { displayName: string; categories: Map<string, number>; accounts: Map<string, number>; budgets: Map<string, number>; count: number };

function toHistories(byMerchant: Map<string, Bucket>): Map<string, MerchantHistory> {
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

// Capture and the draft screen ask for this on every open and on every Expense/Income switch;
// each call used to re-read the whole transaction cache and run normkey (NFKD) over every row —
// seconds once older history is loaded. Both kinds are built in one pass and reused until the
// cache table changes, which a cheap count + newest-sync probe detects.
let memo: { signature: string; byKind: Record<Kind, Map<string, MerchantHistory>> } | null = null;

async function lookups(db: OutboxDb): Promise<Record<Kind, Map<string, MerchantHistory>>> {
  const [probe] = await db.select({ n: sql<number>`count(*)`, last: sql<string | null>`max(${cachedTransactions.syncedAt})` }).from(cachedTransactions);
  const signature = `${probe?.n ?? 0}|${probe?.last ?? ''}`;
  if (memo && memo.signature === signature) return memo.byKind;

  const buckets: Record<Kind, Map<string, Bucket>> = { withdrawal: new Map(), deposit: new Map() };
  const rows = await db.select({
    type: cachedTransactions.type, sourceName: cachedTransactions.sourceName, destinationName: cachedTransactions.destinationName,
    categoryName: cachedTransactions.categoryName, budgetName: cachedTransactions.budgetName,
  }).from(cachedTransactions);
  for (const row of rows) {
    if (row.type !== 'withdrawal' && row.type !== 'deposit') continue; // never a transfer end
    const merchant = row.type === 'withdrawal' ? row.destinationName : row.sourceName;
    if (!merchant) continue;
    const key = normkey(merchant);
    const byMerchant = buckets[row.type];
    const entry = byMerchant.get(key) ?? { displayName: merchant, categories: new Map(), accounts: new Map(), budgets: new Map(), count: 0 };
    entry.count += 1;
    if (row.categoryName) entry.categories.set(row.categoryName, (entry.categories.get(row.categoryName) ?? 0) + 1);
    const accountName = row.type === 'withdrawal' ? row.sourceName : row.destinationName;
    if (accountName) entry.accounts.set(accountName, (entry.accounts.get(accountName) ?? 0) + 1);
    if (row.budgetName) entry.budgets.set(row.budgetName, (entry.budgets.get(row.budgetName) ?? 0) + 1);
    byMerchant.set(key, entry);
  }
  memo = { signature, byKind: { withdrawal: toHistories(buckets.withdrawal), deposit: toHistories(buckets.deposit) } };
  return memo.byKind;
}

/**
 * Payee history from cached transactions: the merchant of a withdrawal, the payer of a deposit.
 * Transfers never count — both ends are the user's own asset accounts, which is how
 * "Cash · Case · PLN" used to show up next to Żabka among capture's payee chips. `type` narrows
 * to payees (withdrawal) or payers (deposit), so each capture type suggests its own kind.
 */
export async function buildMerchantLookup(db: OutboxDb, opts: { type?: Kind } = {}): Promise<Map<string, MerchantHistory>> {
  const byKind = await lookups(db);
  if (opts.type) return byKind[opts.type];
  return new Map([...byKind.withdrawal, ...byKind.deposit]);
}
