import { inArray } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import type {
  AccountRead,
  BudgetRead,
  CategoryRead,
  CurrencyRead,
  SystemInfo,
} from '../api/ff3/types';
import {
  referenceAccounts,
  referenceBudgets,
  referenceCategories,
  referenceCurrencies,
} from '../db/schema';
import type { OutboxDb } from './outbox';
import { setAccountOrder, setFf3Version } from '../settings/appSettings';
import { fetchAll } from './referenceData';
import { pullRecentTransactions } from './pullTransactions';

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
function sameFields<T extends Record<string, unknown>>(
  old: Record<string, unknown> | undefined,
  next: T,
): boolean {
  if (!old) return false;
  return Object.entries(next).every(([key, value]) => key === 'syncedAt' || old[key] === value);
}

/** Keeps each IN (...) list well under SQLite's bound-parameter limit. */
function chunks<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** FF3 calls a loan, debt or mortgage `liabilities` (older versions `liability`); the app keeps one word. */
function accountTypeOf(type: string): string {
  return type === 'liabilities' ? 'liability' : type;
}

export async function pullReferenceData(db: OutboxDb, client: FF3Client): Promise<void> {
  const now = new Date().toISOString();

  const [accountsByType, categories, budgets, currencies, about] = await Promise.all([
    Promise.all(
      ['asset', 'cash', 'expense', 'revenue', 'liabilities'].map((type) =>
        fetchAll<AccountRead>(client, `/v1/accounts?type=${type}`),
      ),
    ),
    fetchAll<CategoryRead>(client, '/v1/categories'),
    fetchAll<BudgetRead>(client, '/v1/budgets'),
    fetchAll<CurrencyRead>(client, '/v1/currencies'),
    client.request<SystemInfo>('/v1/about').catch(() => null),
  ]);
  if (about?.data?.version) await setFf3Version(db, about.data.version);

  // Only new or changed rows are written: rewriting every account, category and budget on every
  // sync fired the change listener once per row for nothing. The rows FF3 returned unchanged get
  // their syncedAt moved in one statement each, so pruneReferenceData still sees them as present.
  const [oldAccounts, oldCategories, oldBudgets, oldCurrencies] = await Promise.all([
    db.select().from(referenceAccounts),
    db.select().from(referenceCategories),
    db.select().from(referenceBudgets),
    db.select().from(referenceCurrencies),
  ]);
  const byKey = <T>(rows: T[], key: (r: T) => string) => new Map(rows.map((r) => [key(r), r]));
  const accountsById = byKey(oldAccounts, (r) => r.id);
  const categoriesById = byKey(oldCategories, (r) => r.id);
  const budgetsById = byKey(oldBudgets, (r) => r.id);
  const currenciesByCode = byKey(oldCurrencies, (r) => r.code);
  const unchanged = {
    accounts: [] as string[],
    categories: [] as string[],
    budgets: [] as string[],
    currencies: [] as string[],
  };

  // One transaction for the whole pull: expo-sqlite runs every write synchronously on the JS
  // thread, and hundreds of separately committed upserts froze the UI on every app open.
  db.transaction((tx) => {
    for (const account of accountsByType.flat()) {
      const extra = account.attributes as AccountExtraAttributes;
      const row = {
        id: account.id,
        name: account.attributes.name,
        type: accountTypeOf(account.attributes.type),
        currencyCode: account.attributes.currency_code,
        active: account.attributes.active,
        currentBalance: extra.current_balance ?? null,
        currentBalanceDate: extra.current_balance_date ?? null,
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
      if (sameFields(accountsById.get(row.id), row)) {
        unchanged.accounts.push(row.id);
        continue;
      }
      tx.insert(referenceAccounts)
        .values(row)
        .onConflictDoUpdate({ target: referenceAccounts.id, set: row })
        .run();
    }
    for (const category of categories) {
      const row = { id: category.id, name: category.attributes.name, syncedAt: now };
      if (sameFields(categoriesById.get(row.id), row)) {
        unchanged.categories.push(row.id);
        continue;
      }
      tx.insert(referenceCategories)
        .values(row)
        .onConflictDoUpdate({ target: referenceCategories.id, set: row })
        .run();
    }
    for (const budget of budgets) {
      const row = {
        id: budget.id,
        name: budget.attributes.name,
        active: budget.attributes.active,
        syncedAt: now,
      };
      if (sameFields(budgetsById.get(row.id), row)) {
        unchanged.budgets.push(row.id);
        continue;
      }
      tx.insert(referenceBudgets)
        .values(row)
        .onConflictDoUpdate({ target: referenceBudgets.id, set: row })
        .run();
    }
    for (const currency of currencies) {
      // CurrencyRead (pinned) predates FF3's `primary`; older servers call it `default`.
      const flags = currency.attributes as {
        enabled?: boolean;
        primary?: boolean;
        default?: boolean;
      };
      const row = {
        code: currency.attributes.code,
        symbol: currency.attributes.symbol,
        decimalPlaces: currency.attributes.decimal_places,
        enabled: flags.enabled ?? true,
        isDefault: flags.primary ?? flags.default ?? false,
        syncedAt: now,
      };
      if (sameFields(currenciesByCode.get(row.code), row)) {
        unchanged.currencies.push(row.code);
        continue;
      }
      tx.insert(referenceCurrencies)
        .values(row)
        .onConflictDoUpdate({ target: referenceCurrencies.code, set: row })
        .run();
    }
    const touch = (
      table:
        | typeof referenceAccounts
        | typeof referenceCategories
        | typeof referenceBudgets
        | typeof referenceCurrencies,
      col: any,
      list: string[],
    ) => {
      for (const ids of chunks(list)) {
        tx.update(table).set({ syncedAt: now }).where(inArray(col, ids)).run();
      }
    };
    touch(referenceAccounts, referenceAccounts.id, unchanged.accounts);
    touch(referenceCategories, referenceCategories.id, unchanged.categories);
    touch(referenceBudgets, referenceBudgets.id, unchanged.budgets);
    touch(referenceCurrencies, referenceCurrencies.code, unchanged.currencies);
  });

  const order: Record<string, number> = {};
  for (const account of accountsByType.flat()) {
    const value = (account.attributes as { order?: number | null }).order;
    if (typeof value === 'number') order[account.id] = value;
  }
  await setAccountOrder(db, order);

  await pullRecentTransactions(db, client, now);
}
