import type { FF3Client } from '../api/ff3/client';
import type { AccountRead, CategoryRead, BudgetRead, CurrencyRead } from '../api/ff3/types';
import { referenceAccounts, referenceCategories, referenceBudgets, referenceCurrencies } from '../db/schema';
import type { OutboxDb } from './outbox';

export async function pullReferenceData(db: OutboxDb, client: FF3Client): Promise<void> {
  const now = new Date().toISOString();

  const [accounts, categories, budgets, currencies] = await Promise.all([
    client.request<{ data: AccountRead[] }>('/v1/accounts?limit=200'),
    client.request<{ data: CategoryRead[] }>('/v1/categories?limit=200'),
    client.request<{ data: BudgetRead[] }>('/v1/budgets?limit=200'),
    client.request<{ data: CurrencyRead[] }>('/v1/currencies?limit=50'),
  ]);

  for (const account of accounts.data) {
    await db.insert(referenceAccounts)
      .values({ id: account.id, name: account.attributes.name, type: account.attributes.type, currencyCode: account.attributes.currency_code, active: account.attributes.active, syncedAt: now })
      .onConflictDoUpdate({ target: referenceAccounts.id, set: { name: account.attributes.name, type: account.attributes.type, currencyCode: account.attributes.currency_code, active: account.attributes.active, syncedAt: now } });
  }
  for (const category of categories.data) {
    await db.insert(referenceCategories)
      .values({ id: category.id, name: category.attributes.name, syncedAt: now })
      .onConflictDoUpdate({ target: referenceCategories.id, set: { name: category.attributes.name, syncedAt: now } });
  }
  for (const budget of budgets.data) {
    await db.insert(referenceBudgets)
      .values({ id: budget.id, name: budget.attributes.name, active: budget.attributes.active, syncedAt: now })
      .onConflictDoUpdate({ target: referenceBudgets.id, set: { name: budget.attributes.name, active: budget.attributes.active, syncedAt: now } });
  }
  for (const currency of currencies.data) {
    await db.insert(referenceCurrencies)
      .values({ code: currency.attributes.code, symbol: currency.attributes.symbol, decimalPlaces: currency.attributes.decimal_places, syncedAt: now })
      .onConflictDoUpdate({ target: referenceCurrencies.code, set: { symbol: currency.attributes.symbol, decimalPlaces: currency.attributes.decimal_places, syncedAt: now } });
  }
}
