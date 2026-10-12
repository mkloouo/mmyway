// Demo mode's data: the throwaway instance's seed (tools/ff3-test/seed.json) turned into the rows
// the sync would have written, so every reader (Activity, pickers, Budget, Planned) takes them
// as-is. Dates are relative to `today`, expanded the way scripts/ff3-test.mjs expands them.
import seedFile from '../../tools/ff3-test/seed.json';
import type { TransactionRead } from '../api/ff3/types';
import { addDecimal, subtractDecimal } from '../api/ff3/decimal';
import {
  bucketObjects,
  cachedTransactions,
  plannedObjects,
  referenceAccounts,
  referenceBudgets,
  referenceCategories,
  referenceCurrencies,
} from '../db/schema';
import { bucketRow } from '../bucket/objects';
import { inPeriod, periodOf } from '../bucket/period';
import { plannedKey } from '../planned/objects';
import { setDefaultSourceAccountId } from '../settings/appSettings';
import type { OutboxDb } from '../sync/outbox';
import { cachedRowFromGroup } from '../sync/referenceData';
import { localDay } from '../utils/day';

interface SeedSplit {
  type: string;
  amount: string;
  description: string;
  source_name: string;
  destination_name: string;
  category_name?: string;
  budget_name?: string;
}

interface SeedTransaction {
  eachMonth?: { from: number; to: number };
  monthsAgo?: number;
  daysAgo?: number;
  day?: number;
  group_title?: string;
  splits: SeedSplit[];
}

interface SeedAccount {
  name: string;
  type: string;
  account_role?: string;
  currency_code?: string;
  opening_balance?: string;
  notes?: string;
}

interface SeedBill {
  name: string;
  amount_min: string;
  amount_max: string;
  currency_code: string;
  repeat_freq: string;
  day: number;
}

export interface DemoSeed {
  currencies: { enable: string[]; primary: string };
  accounts: SeedAccount[];
  categories: string[];
  budgets: string[];
  bills: SeedBill[];
  transactions: SeedTransaction[];
}

/** The Food envelope's limit for the open month. Not in the seed: the demo's own number. */
const FOOD_LIMIT = '400.00';
const FOOD = 'Food';
const SYMBOLS: Record<string, string> = { PLN: 'zł', EUR: '€' };

export interface DemoRows {
  currencies: (typeof referenceCurrencies.$inferInsert)[];
  accounts: (typeof referenceAccounts.$inferInsert)[];
  categories: (typeof referenceCategories.$inferInsert)[];
  budgets: (typeof referenceBudgets.$inferInsert)[];
  transactions: (typeof cachedTransactions.$inferInsert)[];
  planned: (typeof plannedObjects.$inferInsert)[];
  buckets: (typeof bucketObjects.$inferInsert)[];
}

/** `monthsAgo` months back, on `day` (clamped to that month's length, and to today if in the future). */
function monthDate(today: Date, monthsAgo: number, day = 1): string {
  const first = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const d = new Date(first.getFullYear(), first.getMonth(), Math.min(day, last));
  return localDay(d > today ? today : d);
}

function daysAgoDate(today: Date, days: number): string {
  return localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days));
}

interface DemoGroup {
  n: number;
  date: string;
  groupTitle: string | null;
  splits: SeedSplit[];
}

/** scripts/ff3-test.mjs's seedTransactions, minus the FF3 calls: one group per date, `{month}` filled in. */
function expandGroups(seed: DemoSeed, today: Date): DemoGroup[] {
  const groups: Omit<DemoGroup, 'n'>[] = [];
  for (const entry of seed.transactions) {
    let dates: string[];
    if (entry.eachMonth) {
      dates = [];
      for (let m = entry.eachMonth.from; m <= entry.eachMonth.to; m++)
        dates.push(monthDate(today, m, entry.day));
    } else if (entry.monthsAgo !== undefined) {
      dates = [monthDate(today, entry.monthsAgo, entry.day)];
    } else {
      dates = [daysAgoDate(today, entry.daysAgo ?? 0)];
    }
    for (const date of dates) {
      groups.push({
        date,
        groupTitle: entry.group_title ?? null,
        splits: entry.splits.map((s) => ({
          ...s,
          description: s.description.replaceAll('{month}', date.slice(0, 7)),
        })),
      });
    }
  }
  return groups.map((g, i) => ({ ...g, n: i + 1 }));
}

/**
 * Every row the demo writes, as plain objects. No database: tests check these directly, and
 * loadDemoData inserts them.
 */
export function demoRows(seed: DemoSeed, today: Date): DemoRows {
  const syncedAt = today.toISOString();
  const todayDay = localDay(today);
  const primary = seed.currencies.primary;
  const period = periodOf(todayDay);
  const groups = expandGroups(seed, today);

  // FF3 ids are per-instance integers; the demo's are `demo-<n>`, 1-based, in seed order.
  const accountIds = new Map(seed.accounts.map((a, i) => [a.name, `demo-${i + 1}`]));
  const accountByName = new Map(seed.accounts.map((a) => [a.name, a]));
  const categoryIds = new Map(seed.categories.map((name, i) => [name, `demo-${i + 1}`]));
  const budgetIds = new Map(seed.budgets.map((name, i) => [name, `demo-${i + 1}`]));

  // Asset balances: opening balance, moved by every seeded split that touches the account.
  const balances = new Map<string, string>();
  for (const a of seed.accounts) if (a.opening_balance) balances.set(a.name, a.opening_balance);
  for (const g of groups) {
    for (const s of g.splits) {
      const amount = s.amount;
      if (balances.has(s.source_name) && s.type !== 'deposit')
        balances.set(s.source_name, subtractDecimal(balances.get(s.source_name)!, amount));
      if (balances.has(s.destination_name) && s.type !== 'withdrawal')
        balances.set(s.destination_name, addDecimal(balances.get(s.destination_name)!, amount));
    }
  }

  const openingDate = localDay(
    new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()),
  );

  const accounts = seed.accounts.map((a) => {
    const asset = a.type === 'asset';
    return {
      id: accountIds.get(a.name)!,
      name: a.name,
      type: a.type,
      currencyCode: a.currency_code ?? primary,
      active: true,
      currentBalance: asset ? (balances.get(a.name) ?? null) : null,
      currentBalanceDate: asset ? todayDay : null,
      notes: a.notes ?? null,
      accountRole: a.account_role ?? null,
      includeNetWorth: true,
      openingBalance: a.opening_balance ?? null,
      openingBalanceDate: a.opening_balance ? openingDate : null,
      virtualBalance: null,
      creditCardType: null,
      monthlyPaymentDate: null,
      syncedAt,
    };
  });

  const currencies = seed.currencies.enable.map((code) => ({
    code,
    symbol: SYMBOLS[code] ?? code,
    decimalPlaces: 2,
    isDefault: code === primary,
    enabled: true,
    syncedAt,
  }));

  const categories = seed.categories.map((name) => ({
    id: categoryIds.get(name)!,
    name,
    syncedAt,
  }));

  const budgets = seed.budgets.map((name) => ({
    id: budgetIds.get(name)!,
    name,
    active: true,
    syncedAt,
  }));

  // One FF3-shaped group per seeded group, through the same mapper the sync uses.
  const transactions: (typeof cachedTransactions.$inferInsert)[] = [];
  for (const g of groups) {
    const splits = g.splits.map((s, k) => {
      const source = accountByName.get(s.source_name);
      const destination = accountByName.get(s.destination_name);
      const asset = [source, destination].find((a) => a?.type === 'asset');
      const budgetId = s.budget_name ? (budgetIds.get(s.budget_name) ?? null) : null;
      return {
        transaction_journal_id: `demo-${g.n}-${k + 1}`,
        type: s.type,
        date: `${g.date}T12:00:00+00:00`,
        amount: s.amount,
        currency_code: asset?.currency_code ?? primary,
        description: s.description,
        source_id: accountIds.get(s.source_name) ?? null,
        source_name: s.source_name,
        destination_id: accountIds.get(s.destination_name) ?? null,
        destination_name: s.destination_name,
        category_name: s.category_name ?? null,
        budget_id: budgetId,
        budget_name: s.budget_name ?? null,
        tags: [],
        notes: null,
        updated_at: syncedAt,
      };
    });
    const group = {
      id: `demo-${g.n}`,
      type: 'transactions',
      attributes: {
        group_title: g.groupTitle,
        updated_at: syncedAt,
        transactions: splits,
      },
    } as unknown as TransactionRead; // FF3's read shape: nulls where the pinned type has optionals
    const row = cachedRowFromGroup(group, syncedAt);
    if (row) transactions.push(row);
  }

  const planned = seed.bills.map((b, i) => {
    const id = `demo-${i + 1}`;
    const date = monthDate(today, 0, b.day);
    const attributes = {
      name: b.name,
      amount_min: b.amount_min,
      amount_max: b.amount_max,
      currency_code: b.currency_code,
      repeat_freq: b.repeat_freq,
      date,
      next_expected_match: date,
      end_date: null,
      active: true,
      skip: 0,
      notes: null,
    };
    return {
      key: plannedKey('bill', id),
      kind: 'bill' as const,
      ff3Id: id,
      name: b.name,
      attributesJson: JSON.stringify(attributes),
      syncedAt,
    };
  });

  // This month's Food spending, from the seeded splits themselves (a group's total can mix budgets).
  const foodId = budgetIds.get(FOOD);
  const buckets: (typeof bucketObjects.$inferInsert)[] = [];
  if (foodId) {
    let spent = '0';
    for (const g of groups) {
      if (!inPeriod(period, g.date)) continue;
      for (const s of g.splits)
        if (s.type === 'withdrawal' && s.budget_name === FOOD) spent = addDecimal(spent, s.amount);
    }
    const negative = subtractDecimal('0', spent);
    const common = { currency_code: primary };
    buckets.push(
      bucketRow(
        'budget_limit',
        foodId,
        period.start,
        {
          ...common,
          id: `demo-limit-${foodId}`,
          budget_id: foodId,
          amount: FOOD_LIMIT,
          spent: negative,
          start: period.start,
          end: period.end,
          period: 'monthly',
          notes: null,
          updated_at: syncedAt,
        },
        syncedAt,
      ),
      bucketRow('budget_spent', foodId, period.start, { ...common, spent: negative }, syncedAt),
    );
  }

  return { currencies, accounts, categories, budgets, transactions, planned, buckets };
}

/** Writes the demo's rows in one transaction. The caller clears the instance's data first (startDemo). */
export async function loadDemoData(db: OutboxDb, today: Date = new Date()): Promise<void> {
  const rows = demoRows(seedFile as DemoSeed, today);
  db.transaction((tx) => {
    for (const row of rows.currencies) tx.insert(referenceCurrencies).values(row).run();
    for (const row of rows.accounts) tx.insert(referenceAccounts).values(row).run();
    for (const row of rows.categories) tx.insert(referenceCategories).values(row).run();
    for (const row of rows.budgets) tx.insert(referenceBudgets).values(row).run();
    for (const row of rows.transactions) tx.insert(cachedTransactions).values(row).run();
    for (const row of rows.planned) tx.insert(plannedObjects).values(row).run();
    for (const row of rows.buckets) tx.insert(bucketObjects).values(row).run();
  });
  // Capture's source account defaults to the demo's Checking, so a first capture has one to use.
  const checking = rows.accounts.find((a) => a.name === 'Checking');
  if (checking) await setDefaultSourceAccountId(db, checking.id);
}
