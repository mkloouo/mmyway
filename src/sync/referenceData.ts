import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import type { AccountRead, CategoryRead, BudgetRead, CurrencyRead, TransactionRead } from '../api/ff3/types';
import { referenceAccounts, referenceCategories, referenceBudgets, referenceCurrencies, cachedTransactions, outboxOperations } from '../db/schema';
import type { OutboxDb } from './outbox';
import { logLine } from '../utils/log';
import { setAccountOrder } from '../settings/appSettings';
import { addDecimal } from '../api/ff3/decimal';
import { normkey } from '../lookup/normkey';

const PAGE_SIZE = 100;

// FF3 paginates every collection endpoint, so a single request truncates silently: a real
// instance has hundreds of expense accounts, and asking for one page of accounts returned
// nothing but payees — no asset account ever reached the device.
async function fetchAll<T>(client: FF3Client, path: string): Promise<T[]> {
  const separator = path.includes('?') ? '&' : '?';
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const response = await client.request<{ data: T[] }>(`${path}${separator}limit=${PAGE_SIZE}&page=${page}`);
    out.push(...response.data);
    if (response.data.length < PAGE_SIZE) return out;
  }
}

// AccountRead (src/api/ff3/types.ts, pinned) doesn't declare these — narrowed with a local
// cast at the read site, as recurringReview.ts already does for the group's updated_at.
type AccountExtraAttributes = {
  current_balance?: string;
  current_balance_date?: string;
  notes?: string | null;
  account_role?: string | null;
  include_net_worth?: boolean;
  opening_balance?: string | null;
  opening_balance_date?: string | null;
  virtual_balance?: string | null;
  credit_card_type?: string | null;
  monthly_payment_date?: string | null;
};

/** FF3 answers dates as full ISO timestamps; the account page edits the calendar day. */
function calendarDay(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

/** Whether a stored row already holds every field of `next` (syncedAt aside). */
function sameFields<T extends Record<string, unknown>>(old: Record<string, unknown> | undefined, next: T): boolean {
  if (!old) return false;
  return Object.entries(next).every(([key, value]) => key === 'syncedAt' || old[key] === value);
}

/** Keeps each IN (...) list well under SQLite's bound-parameter limit. */
function chunks<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function pullReferenceData(db: OutboxDb, client: FF3Client): Promise<void> {
  const now = new Date().toISOString();

  const [accountsByType, categories, budgets, currencies] = await Promise.all([
    Promise.all(['asset', 'cash', 'expense', 'revenue'].map((type) => fetchAll<AccountRead>(client, `/v1/accounts?type=${type}`))),
    fetchAll<CategoryRead>(client, '/v1/categories'),
    fetchAll<BudgetRead>(client, '/v1/budgets'),
    fetchAll<CurrencyRead>(client, '/v1/currencies'),
  ]);

  // Only new or changed rows are written: rewriting every account, category and budget on every
  // sync fired the change listener once per row for nothing. The rows FF3 returned unchanged get
  // their syncedAt moved in one statement each, so pruneReferenceData still sees them as present.
  const [oldAccounts, oldCategories, oldBudgets, oldCurrencies] = await Promise.all([
    db.select().from(referenceAccounts), db.select().from(referenceCategories),
    db.select().from(referenceBudgets), db.select().from(referenceCurrencies),
  ]);
  const byKey = <T,>(rows: T[], key: (r: T) => string) => new Map(rows.map((r) => [key(r), r]));
  const accountsById = byKey(oldAccounts, (r) => r.id);
  const categoriesById = byKey(oldCategories, (r) => r.id);
  const budgetsById = byKey(oldBudgets, (r) => r.id);
  const currenciesByCode = byKey(oldCurrencies, (r) => r.code);
  const unchanged = { accounts: [] as string[], categories: [] as string[], budgets: [] as string[], currencies: [] as string[] };

  // One transaction for the whole pull: expo-sqlite runs every write synchronously on the JS
  // thread, and hundreds of separately committed upserts froze the UI on every app open.
  db.transaction((tx) => {
    for (const account of accountsByType.flat()) {
      const extra = account.attributes as AccountExtraAttributes;
      const row = {
        id: account.id, name: account.attributes.name, type: account.attributes.type,
        currencyCode: account.attributes.currency_code, active: account.attributes.active,
        currentBalance: extra.current_balance ?? null, currentBalanceDate: extra.current_balance_date ?? null,
        notes: extra.notes ?? null,
        accountRole: extra.account_role ?? null,
        includeNetWorth: extra.include_net_worth ?? true,
        openingBalance: extra.opening_balance ?? null,
        openingBalanceDate: calendarDay(extra.opening_balance_date),
        virtualBalance: extra.virtual_balance ?? null,
        creditCardType: extra.credit_card_type ?? null,
        monthlyPaymentDate: calendarDay(extra.monthly_payment_date),
        syncedAt: now,
      };
      if (sameFields(accountsById.get(row.id), row)) { unchanged.accounts.push(row.id); continue; }
      tx.insert(referenceAccounts).values(row).onConflictDoUpdate({ target: referenceAccounts.id, set: row }).run();
    }
    for (const category of categories) {
      const row = { id: category.id, name: category.attributes.name, syncedAt: now };
      if (sameFields(categoriesById.get(row.id), row)) { unchanged.categories.push(row.id); continue; }
      tx.insert(referenceCategories).values(row).onConflictDoUpdate({ target: referenceCategories.id, set: row }).run();
    }
    for (const budget of budgets) {
      const row = { id: budget.id, name: budget.attributes.name, active: budget.attributes.active, syncedAt: now };
      if (sameFields(budgetsById.get(row.id), row)) { unchanged.budgets.push(row.id); continue; }
      tx.insert(referenceBudgets).values(row).onConflictDoUpdate({ target: referenceBudgets.id, set: row }).run();
    }
    for (const currency of currencies) {
      // CurrencyRead (pinned) predates FF3's `primary`; older servers call it `default`.
      const flags = currency.attributes as { enabled?: boolean; primary?: boolean; default?: boolean };
      const row = {
        code: currency.attributes.code, symbol: currency.attributes.symbol, decimalPlaces: currency.attributes.decimal_places,
        enabled: flags.enabled ?? true, isDefault: flags.primary ?? flags.default ?? false, syncedAt: now,
      };
      if (sameFields(currenciesByCode.get(row.code), row)) { unchanged.currencies.push(row.code); continue; }
      tx.insert(referenceCurrencies).values(row).onConflictDoUpdate({ target: referenceCurrencies.code, set: row }).run();
    }
    for (const ids of chunks(unchanged.accounts)) tx.update(referenceAccounts).set({ syncedAt: now }).where(inArray(referenceAccounts.id, ids)).run();
    for (const ids of chunks(unchanged.categories)) tx.update(referenceCategories).set({ syncedAt: now }).where(inArray(referenceCategories.id, ids)).run();
    for (const ids of chunks(unchanged.budgets)) tx.update(referenceBudgets).set({ syncedAt: now }).where(inArray(referenceBudgets.id, ids)).run();
    for (const codes of chunks(unchanged.currencies)) tx.update(referenceCurrencies).set({ syncedAt: now }).where(inArray(referenceCurrencies.code, codes)).run();
  });

  const order: Record<string, number> = {};
  for (const account of accountsByType.flat()) {
    const value = (account.attributes as { order?: number | null }).order;
    if (typeof value === 'number') order[account.id] = value;
  }
  await setAccountOrder(db, order);

  await pullRecentTransactions(db, client, now);
}

/**
 * Re-reads the balances of asset accounts already cached — nothing else. The full pull runs
 * before the outbox replay and a push sync has none, so without this the balances stayed at
 * their pre-replay values after spending reached FF3, and the cash count booked that spending
 * again as drift. Accounts not yet cached are left for the next full pull.
 */
export async function pullAccountBalances(db: OutboxDb, client: FF3Client): Promise<void> {
  const accounts = await fetchAll<AccountRead>(client, '/v1/accounts?type=asset');
  db.transaction((tx) => {
    for (const account of accounts) {
      const extra = account.attributes as { current_balance?: string; current_balance_date?: string };
      tx.update(referenceAccounts)
        .set({ currentBalance: extra.current_balance ?? null, currentBalanceDate: extra.current_balance_date ?? null })
        .where(eq(referenceAccounts.id, account.id)).run();
    }
  });
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

export type CachedTransactionInsert = typeof cachedTransactions.$inferInsert;

/** One cached row per FF3 transaction group. Also used by the outbox to store the server's copy on a conflict. */
/** What Activity search matches against: each field folded by normkey, kept apart so a query can't span two. */
export function searchKeyOf(parts: (string | null | undefined)[]): string {
  return parts.map((p) => normkey(p ?? '')).join('|');
}

export function cachedRowFromGroup(group: TransactionRead, syncedAt: string): CachedTransactionInsert | null {
  // One row per group (cachedTransactions is keyed by groupId). A split transaction is shown as
  // one entry: the splits' total (when they share a currency) under the group's title, with the
  // first split's accounts and category. Edits still go to the first journal, so the detail
  // screen doesn't offer to change a split group's amount.
  const splits = group.attributes.transactions;
  const journal = splits[0];
  if (!journal) return null;
  // FF3 read responses carry these; TransactionSplit (pinned) doesn't declare them all.
  const extra = journal as { budget_name?: string | null; budget_id?: string | number | null; source_id?: string | number | null; destination_id?: string | number | null };
  const sameCurrency = splits.every((s) => s.currency_code === journal.currency_code);
  const amount = splits.length > 1 && sameCurrency ? splits.map((s) => s.amount).reduce((a, b) => addDecimal(a, b)) : journal.amount;
  const groupTitle = (group.attributes as { group_title?: string | null }).group_title;
  const description = splits.length > 1 && groupTitle ? groupTitle : journal.description;
  const sourceName = journal.source_name ?? null;
  const destinationName = journal.destination_name ?? null;

  return {
    groupId: group.id,
    journalId: journal.transaction_journal_id,
    type: journal.type,
    date: journal.date,
    amount,
    // Read responses always populate currency_code; TransactionSplit only marks it optional
    // because the same type also covers write payloads, which can omit it.
    currencyCode: journal.currency_code!,
    foreignAmount: splits.length > 1 ? null : journal.foreign_amount ?? null,
    foreignCurrencyCode: splits.length > 1 ? null : journal.foreign_currency_code ?? null,
    description,
    sourceName,
    destinationName,
    sourceId: extra.source_id != null ? String(extra.source_id) : null,
    destinationId: extra.destination_id != null ? String(extra.destination_id) : null,
    categoryName: journal.category_name ?? null,
    budgetName: extra.budget_name ?? null,
    budgetId: extra.budget_id != null ? String(extra.budget_id) : null,
    splitCount: splits.length,
    searchKey: searchKeyOf([description, ...splits.map((s) => s.description), sourceName, destinationName]),
    tagsJson: JSON.stringify(journal.tags ?? []),
    notes: journal.notes ?? null,
    // FF3 puts updated_at on the group's attributes, not on each split — journal.updated_at
    // is undefined against real API responses despite what TransactionSplit's type claims
    // (confirmed on a real device sync: NOT NULL constraint failed: cached_transactions.updated_at).
    updatedAt: (group.attributes as { updated_at?: string }).updated_at ?? journal.updated_at ?? syncedAt,
    syncedAt,
  };
}

/**
 * Rows cached before the search key and account ids existed (migration 0007) get them here, once:
 * the key from their own text, the ids by account name — the best a row without them can do.
 */
export async function backfillCachedTransactions(db: OutboxDb): Promise<void> {
  const rows = await db.select({
    groupId: cachedTransactions.groupId, description: cachedTransactions.description,
    sourceName: cachedTransactions.sourceName, destinationName: cachedTransactions.destinationName,
  }).from(cachedTransactions).where(isNull(cachedTransactions.searchKey));
  if (rows.length === 0) return;
  db.transaction((tx) => {
    for (const row of rows) {
      tx.update(cachedTransactions)
        .set({ searchKey: searchKeyOf([row.description, row.sourceName, row.destinationName]) })
        .where(eq(cachedTransactions.groupId, row.groupId)).run();
    }
  });
  await db.update(cachedTransactions)
    .set({ sourceId: sql`(select id from reference_accounts where reference_accounts.name = cached_transactions.source_name limit 1)` })
    .where(isNull(cachedTransactions.sourceId));
  await db.update(cachedTransactions)
    .set({ destinationId: sql`(select id from reference_accounts where reference_accounts.name = cached_transactions.destination_name limit 1)` })
    .where(isNull(cachedTransactions.destinationId));
}

// Shared by pullRecentTransactions (catch-up window) and pullOlderTransactions (scrolling past
// the local cache) — both just page a date range into cachedTransactions. `endDate` is omitted
// for the catch-up window (it always runs to today) and set for the older-history pull, so each
// scroll only re-walks its own chunk instead of the whole history back to today every time.
async function pullTransactionsInRange(db: OutboxDb, client: FF3Client, startDate: string, syncedAt: string, endDate?: string): Promise<void> {
  const endParam = endDate ? `&end=${endDate}` : '';
  const seen = new Set<string>();
  // Pages until the requested history window is covered — no upper page bound, so a long real
  // history is never silently truncated.
  for (let page = 1; ; page++) {
    const response = await client.request<{ data: TransactionRead[] }>(
      `/v1/transactions?start=${startDate}${endParam}&limit=100&page=${page}`,
    );
    if (response.data.length === 0) break;
    for (const group of response.data) seen.add(group.id);

    // One transaction per page, for the same reason as pullReferenceData's.
    db.transaction((tx) => {
      for (const group of response.data) {
        const row = cachedRowFromGroup(group, syncedAt);
        if (!row) continue;
        tx.insert(cachedTransactions).values(row).onConflictDoUpdate({ target: cachedTransactions.groupId, set: row }).run();
      }
    });

    if (response.data.length < 100) break;
  }

  await pruneDeletedInWindow(db, seen, startDate, endDate ?? dateOnly(new Date()));
}

/**
 * The window above was read completely, so a cached row dated inside it that FF3 did not return
 * was deleted in FF3 (its web UI, another client). Pulls only upsert, so it used to stay in
 * Activity and payee history for good. Rows an outbox op still refers to are left for that op to
 * settle; only reached when every page came back (a failed request throws before this).
 */
async function pruneDeletedInWindow(db: OutboxDb, seen: Set<string>, startDate: string, endDate: string): Promise<void> {
  const inWindow = await db.select({ groupId: cachedTransactions.groupId }).from(cachedTransactions)
    .where(and(
      gte(sql`substr(${cachedTransactions.date}, 1, 10)`, startDate),
      lte(sql`substr(${cachedTransactions.date}, 1, 10)`, endDate),
    ));
  const gone = inWindow.map((r) => r.groupId).filter((id) => !seen.has(id));
  if (gone.length === 0) return;
  const queued = new Set((await db.select({ payloadJson: outboxOperations.payloadJson }).from(outboxOperations))
    .map((op) => { try { return (JSON.parse(op.payloadJson) as { groupId?: string }).groupId; } catch { return undefined; } })
    .filter((id): id is string => !!id));
  const removable = gone.filter((id) => !queued.has(id));
  for (let i = 0; i < removable.length; i += 500) {
    await db.delete(cachedTransactions).where(inArray(cachedTransactions.groupId, removable.slice(i, i + 500)));
  }
}

// Feeds cachedTransactions, which src/sync/outbox.ts's conflict check and
// src/lookup/merchantLookup.ts's suggestion history both read — without this nothing ever
// populates that table and both go silently inert.
export async function pullRecentTransactions(db: OutboxDb, client: FF3Client, syncedAt: string): Promise<void> {
  const startDate = await windowStart(db);
  await pullTransactionsInRange(db, client, startDate, syncedAt);
}

/** Below a year of local history, walk 3 months per "load more"; beyond that, a year at a time —
 * a long-lived account otherwise takes dozens of scrolls to reach anything old. */
const OLDER_CHUNK_MONTHS_RECENT = 3;
const OLDER_CHUNK_MONTHS_DEEP = 12;
const DEEP_HISTORY_YEARS = 1;

// A safety valve, not the intended stopping condition: anyTransactionsBefore already proves
// whether to keep walking, and `anchor` moves strictly further back every attempt, so a real
// history always terminates well under this. Only a misbehaving server (total > 0 forever, no
// data ever returned) would ever reach it.
const MAX_CHUNK_ATTEMPTS = 40;

function chunkMonthsFor(anchor: Date): number {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - DEEP_HISTORY_YEARS);
  return anchor < cutoff ? OLDER_CHUNK_MONTHS_DEEP : OLDER_CHUNK_MONTHS_RECENT;
}

async function oldestCachedDate(db: OutboxDb): Promise<string | null> {
  const [oldest] = await db.select({ date: cachedTransactions.date }).from(cachedTransactions)
    .orderBy(cachedTransactions.date).limit(1);
  return oldest?.date ?? null;
}

// Asks FF3 directly whether anything strictly older than `beforeDate` exists at all — the one
// reliable way to tell "this chunk was quiet" from "that's the end of history", since FF3's
// meta.pagination.total counts the whole match set, not just this page.
async function anyTransactionsBefore(client: FF3Client, beforeDate: string): Promise<boolean> {
  const response = await client.request<{ meta: { pagination: { total: number } } }>(
    `/v1/transactions?end=${beforeDate}&limit=1&page=1`,
  );
  return response.meta.pagination.total > 0;
}

// Activity's infinite scroll only ever reads the local cache (useTransactionPage) — the initial
// sync only backfills BACKFILL_MONTHS, so scrolling past that found nothing older to page into.
// Called when the list runs out of locally cached rows; walks chunks of history into
// cachedTransactions (widening past any quiet ones) and reports whether real history remains
// beyond what's now cached, so the caller can stop asking once it's genuinely exhausted.
export async function pullOlderTransactions(db: OutboxDb, client: FF3Client, syncedAt: string): Promise<boolean> {
  const before = await oldestCachedDate(db);
  let anchor = before ? new Date(before) : new Date();

  for (let attempt = 0; attempt < MAX_CHUNK_ATTEMPTS; attempt++) {
    // end and start are each computed from `anchor` directly (not chained off one another), so a
    // short month can't roll the day-of-month over and throw the window off by a few days.
    const end = new Date(anchor);
    end.setDate(end.getDate() - 1); // strictly older than what's already cached
    const start = new Date(anchor);
    start.setMonth(start.getMonth() - chunkMonthsFor(anchor));
    await pullTransactionsInRange(db, client, dateOnly(start), syncedAt, dateOnly(end));

    const after = await oldestCachedDate(db);
    if (after && after !== before) return true; // this chunk found something to cache

    if (!(await anyTransactionsBefore(client, dateOnly(end)))) return false; // genuinely exhausted
    anchor = start; // that chunk was quiet, but more history exists further back — keep walking
  }
  // Reached the safety valve — FF3 kept claiming more exists but never handed any of it back.
  logLine('warn', `pullOlderTransactions: gave up after ${MAX_CHUNK_ATTEMPTS} quiet chunks before ${dateOnly(anchor)}`);
  return true;
}
