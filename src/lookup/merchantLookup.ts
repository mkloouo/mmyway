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
  /** Date of the most recent transaction with this payee (ISO 8601) — suggestions sort by it. */
  lastUsed: string;
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
type Bucket = {
  displayName: string;
  categories: Map<string, number>;
  accounts: Map<string, number>;
  budgets: Map<string, number>;
  count: number;
  lastUsed: string;
};

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
      lastUsed: entry.lastUsed,
    });
  }
  return result;
}

// Capture and the draft screen ask for this on every open and on every Expense/Income switch;
// each call used to re-read the whole transaction cache and run normkey (NFKD) over every row —
// seconds once older history is loaded. Both kinds are built in one pass and reused until the
// cache table changes, which a cheap count + newest-sync probe detects.
type Lookups = {
  byKind: Record<Kind, Map<string, MerchantHistory>>;
  accountLastUsed: Map<string, string>;
};
let memo: { signature: string; value: Lookups } | null = null;

async function lookups(db: OutboxDb): Promise<Lookups> {
  const [probe] = await db
    .select({
      n: sql<number>`count(*)`,
      last: sql<string | null>`max(${cachedTransactions.syncedAt})`,
    })
    .from(cachedTransactions);
  const signature = `${probe?.n ?? 0}|${probe?.last ?? ''}`;
  if (memo && memo.signature === signature) return memo.value;

  const buckets: Record<Kind, Map<string, Bucket>> = { withdrawal: new Map(), deposit: new Map() };
  const accountLastUsed = new Map<string, string>();
  const touch = (name: string | null, date: string) => {
    if (name && (accountLastUsed.get(name) ?? '') < date) accountLastUsed.set(name, date);
  };
  const rows = await db
    .select({
      type: cachedTransactions.type,
      date: cachedTransactions.date,
      sourceName: cachedTransactions.sourceName,
      destinationName: cachedTransactions.destinationName,
      categoryName: cachedTransactions.categoryName,
      budgetName: cachedTransactions.budgetName,
    })
    .from(cachedTransactions);
  for (const row of rows) {
    // Asset-account recency, for capture's From/To chips: the user's own end of every transaction.
    if (row.type === 'withdrawal') touch(row.sourceName, row.date);
    else if (row.type === 'deposit') touch(row.destinationName, row.date);
    else if (row.type === 'transfer') {
      touch(row.sourceName, row.date);
      touch(row.destinationName, row.date);
    }

    if (row.type !== 'withdrawal' && row.type !== 'deposit') continue; // never a transfer end
    const merchant = row.type === 'withdrawal' ? row.destinationName : row.sourceName;
    if (!merchant) continue;
    const key = normkey(merchant);
    const byMerchant = buckets[row.type];
    const entry = byMerchant.get(key) ?? {
      displayName: merchant,
      categories: new Map(),
      accounts: new Map(),
      budgets: new Map(),
      count: 0,
      lastUsed: '',
    };
    entry.count += 1;
    if (row.date > entry.lastUsed) {
      entry.lastUsed = row.date;
      entry.displayName = merchant;
    }
    if (row.categoryName)
      entry.categories.set(row.categoryName, (entry.categories.get(row.categoryName) ?? 0) + 1);
    const accountName = row.type === 'withdrawal' ? row.sourceName : row.destinationName;
    if (accountName) entry.accounts.set(accountName, (entry.accounts.get(accountName) ?? 0) + 1);
    if (row.budgetName)
      entry.budgets.set(row.budgetName, (entry.budgets.get(row.budgetName) ?? 0) + 1);
    byMerchant.set(key, entry);
  }
  memo = {
    signature,
    value: {
      byKind: {
        withdrawal: toHistories(buckets.withdrawal),
        deposit: toHistories(buckets.deposit),
      },
      accountLastUsed,
    },
  };
  return memo.value;
}

/**
 * Builds the lookups ahead of time — called once the database is ready and after each sync — so
 * the first Capture of the session finds them ready instead of scanning the cache on open.
 */
export async function warmMerchantLookup(db: OutboxDb): Promise<void> {
  await lookups(db);
}

/** What the last build holds, synchronously (null before the first) — a screen's first frame. */
export function peekMerchantLookup(type?: Kind): MerchantHistory[] | null {
  if (!memo) return null;
  return [
    ...(type
      ? memo.value.byKind[type]
      : new Map([...memo.value.byKind.withdrawal, ...memo.value.byKind.deposit])
    ).values(),
  ];
}

/** When each asset account (by name) last had a transaction; ISO date strings. */
export async function accountLastUsed(db: OutboxDb): Promise<Map<string, string>> {
  return (await lookups(db)).accountLastUsed;
}
export function peekAccountLastUsed(): Map<string, string> | null {
  return memo?.value.accountLastUsed ?? null;
}

/**
 * Payee history from cached transactions: the merchant of a withdrawal, the payer of a deposit.
 * Transfers never count — both ends are the user's own asset accounts, which is how
 * "Cash · Case · PLN" used to show up next to Żabka among capture's payee chips. `type` narrows
 * to payees (withdrawal) or payers (deposit), so each capture type suggests its own kind.
 */
export async function buildMerchantLookup(
  db: OutboxDb,
  opts: { type?: Kind } = {},
): Promise<Map<string, MerchantHistory>> {
  const { byKind } = await lookups(db);
  if (opts.type) return byKind[opts.type];
  return new Map([...byKind.withdrawal, ...byKind.deposit]);
}
