import { desc } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import type { AccountRead, CategoryRead, BudgetRead, CurrencyRead, TransactionRead } from '../api/ff3/types';
import { referenceAccounts, referenceCategories, referenceBudgets, referenceCurrencies, cachedTransactions } from '../db/schema';
import type { OutboxDb } from './outbox';

const PAGE_SIZE = 100;

// FF3 paginates every collection endpoint, so a single request truncates silently: a real
// instance has hundreds of expense accounts, and asking for one page of accounts returned
// nothing but payees — no asset account ever reached the device (docs/bugs-found.md).
async function fetchAll<T>(client: FF3Client, path: string): Promise<T[]> {
  const separator = path.includes('?') ? '&' : '?';
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const response = await client.request<{ data: T[] }>(`${path}${separator}limit=${PAGE_SIZE}&page=${page}`);
    out.push(...response.data);
    if (response.data.length < PAGE_SIZE) return out;
  }
}

export async function pullReferenceData(db: OutboxDb, client: FF3Client): Promise<void> {
  const now = new Date().toISOString();

  const [accountsByType, categories, budgets, currencies] = await Promise.all([
    Promise.all(['asset', 'cash', 'expense', 'revenue'].map((type) => fetchAll<AccountRead>(client, `/v1/accounts?type=${type}`))),
    fetchAll<CategoryRead>(client, '/v1/categories'),
    fetchAll<BudgetRead>(client, '/v1/budgets'),
    fetchAll<CurrencyRead>(client, '/v1/currencies'),
  ]);

  // One transaction for the whole pull: expo-sqlite runs every write synchronously on the JS
  // thread, and hundreds of separately committed upserts froze the UI on every app open.
  db.transaction((tx) => {
    for (const account of accountsByType.flat()) {
      // AccountRead (src/api/ff3/types.ts, pinned) doesn't declare these — narrowed with a local
      // cast at the read site, as recurringReview.ts already does for the group's updated_at.
      const extra = account.attributes as { current_balance?: string; current_balance_date?: string; notes?: string | null };
      const row = {
        id: account.id, name: account.attributes.name, type: account.attributes.type,
        currencyCode: account.attributes.currency_code, active: account.attributes.active,
        currentBalance: extra.current_balance ?? null, currentBalanceDate: extra.current_balance_date ?? null,
        notes: extra.notes ?? null,
        syncedAt: now,
      };
      tx.insert(referenceAccounts).values(row).onConflictDoUpdate({ target: referenceAccounts.id, set: row }).run();
    }
    for (const category of categories) {
      tx.insert(referenceCategories)
        .values({ id: category.id, name: category.attributes.name, syncedAt: now })
        .onConflictDoUpdate({ target: referenceCategories.id, set: { name: category.attributes.name, syncedAt: now } }).run();
    }
    for (const budget of budgets) {
      tx.insert(referenceBudgets)
        .values({ id: budget.id, name: budget.attributes.name, active: budget.attributes.active, syncedAt: now })
        .onConflictDoUpdate({ target: referenceBudgets.id, set: { name: budget.attributes.name, active: budget.attributes.active, syncedAt: now } }).run();
    }
    for (const currency of currencies) {
      tx.insert(referenceCurrencies)
        .values({ code: currency.attributes.code, symbol: currency.attributes.symbol, decimalPlaces: currency.attributes.decimal_places, syncedAt: now })
        .onConflictDoUpdate({ target: referenceCurrencies.code, set: { symbol: currency.attributes.symbol, decimalPlaces: currency.attributes.decimal_places, syncedAt: now } }).run();
    }
  });

  await pullRecentTransactions(db, client, now);
}

/** How far back the very first sync reaches, in months. */
const BACKFILL_MONTHS = 3;
/** How far back every later sync re-reads, in days — enough to catch a back-dated entry. */
const CATCHUP_DAYS = 14;

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// The history window this sync asks FF3 for. Empty cache: the full backfill. Otherwise a short
// window ending at the newest row already cached — re-walking three months of pages on every app
// open was the "it pulls everything from 0 every time I open the app" report, and each of those
// thousands of row upserts also fires expo-sqlite's change listener, which re-runs every mounted
// useLiveQuery on screen.
async function windowStart(db: OutboxDb): Promise<string> {
  const [newest] = await db.select({ date: cachedTransactions.date }).from(cachedTransactions)
    .orderBy(desc(cachedTransactions.date)).limit(1);
  if (!newest) {
    const backfill = new Date();
    backfill.setMonth(backfill.getMonth() - BACKFILL_MONTHS);
    return dateOnly(backfill);
  }
  // A future-dated cached row must not push the window past today, or the pull would stop
  // seeing anything new.
  const start = new Date(Math.min(new Date(newest.date).getTime(), Date.now()));
  start.setDate(start.getDate() - CATCHUP_DAYS);
  return dateOnly(start);
}

// Shared by pullRecentTransactions (catch-up window) and pullOlderTransactions (scrolling past
// the local cache) — both just page a date range into cachedTransactions. `endDate` is omitted
// for the catch-up window (it always runs to today) and set for the older-history pull, so each
// scroll only re-walks its own chunk instead of the whole history back to today every time.
async function pullTransactionsInRange(db: OutboxDb, client: FF3Client, startDate: string, syncedAt: string, endDate?: string): Promise<void> {
  const endParam = endDate ? `&end=${endDate}` : '';
  // Pages until the requested history window is covered — no upper page bound, so a long real
  // history is never silently truncated.
  for (let page = 1; ; page++) {
    const response = await client.request<{ data: TransactionRead[] }>(
      `/v1/transactions?start=${startDate}${endParam}&limit=100&page=${page}`,
    );
    if (response.data.length === 0) break;

    // One transaction per page, for the same reason as pullReferenceData's.
    db.transaction((tx) => {
      for (const group of response.data) {
        // Only the first split is cached — cachedTransactions is keyed by groupId (one row per
        // group), matching src/sync/recurringReview.ts's existing single-journal assumption.
        const journal = group.attributes.transactions[0];
        if (!journal) continue;

        const row = {
          groupId: group.id,
          journalId: journal.transaction_journal_id,
          type: journal.type,
          date: journal.date,
          amount: journal.amount,
          // Read responses always populate currency_code; TransactionSplit only marks it optional
          // because the same type also covers write payloads, which can omit it.
          currencyCode: journal.currency_code!,
          foreignAmount: journal.foreign_amount ?? null,
          foreignCurrencyCode: journal.foreign_currency_code ?? null,
          description: journal.description,
          sourceName: journal.source_name ?? null,
          destinationName: journal.destination_name ?? null,
          categoryName: journal.category_name ?? null,
          // TransactionSplit has no budget_name field (only budget_id) — left null until
          // src/api/ff3/types.ts (generated/pinned) grows one.
          budgetName: null as string | null,
          tagsJson: JSON.stringify(journal.tags ?? []),
          notes: journal.notes ?? null,
          // FF3 puts updated_at on the group's attributes, not on each split — journal.updated_at
          // is undefined against real API responses despite what TransactionSplit's type claims
          // (confirmed on a real device sync: NOT NULL constraint failed: cached_transactions.updated_at).
          updatedAt: (group.attributes as { updated_at?: string }).updated_at ?? journal.updated_at ?? syncedAt,
          syncedAt,
        };
        tx.insert(cachedTransactions).values(row).onConflictDoUpdate({ target: cachedTransactions.groupId, set: row }).run();
      }
    });

    if (response.data.length < 100) break;
  }
}

// Feeds cachedTransactions, which src/sync/outbox.ts's conflict check and
// src/lookup/merchantLookup.ts's suggestion history both read — without this nothing ever
// populates that table and both go silently inert.
export async function pullRecentTransactions(db: OutboxDb, client: FF3Client, syncedAt: string): Promise<void> {
  const startDate = await windowStart(db);
  await pullTransactionsInRange(db, client, startDate, syncedAt);
}

/** How far past the local cache's oldest row each "load more" scroll reaches, in months. */
const OLDER_CHUNK_MONTHS = 3;

async function oldestCachedDate(db: OutboxDb): Promise<string | null> {
  const [oldest] = await db.select({ date: cachedTransactions.date }).from(cachedTransactions)
    .orderBy(cachedTransactions.date).limit(1);
  return oldest?.date ?? null;
}

// Activity's infinite scroll only ever reads the local cache (useTransactionPage) — the initial
// sync only backfills BACKFILL_MONTHS, so scrolling past that found nothing older to page into.
// Called when the list runs out of locally cached rows; re-walks a further chunk of history into
// cachedTransactions and reports whether that pushed the cached window any older, so the caller
// can stop asking once real history (not just the current filter) is exhausted.
export async function pullOlderTransactions(db: OutboxDb, client: FF3Client, syncedAt: string): Promise<boolean> {
  const before = await oldestCachedDate(db);
  const oldest = before ? new Date(before) : new Date();
  // end and start are each computed from `oldest` directly (not chained off one another), so a
  // short month can't roll the day-of-month over and throw the window off by a few days.
  const end = new Date(oldest);
  end.setDate(end.getDate() - 1); // strictly older than what's already cached
  const start = new Date(oldest);
  start.setMonth(start.getMonth() - OLDER_CHUNK_MONTHS);
  await pullTransactionsInRange(db, client, dateOnly(start), syncedAt, dateOnly(end));
  const after = await oldestCachedDate(db);
  return !!after && after !== before;
}
