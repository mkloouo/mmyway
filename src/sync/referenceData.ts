import type { FF3Client } from '../api/ff3/client';
import type { AccountRead, CategoryRead, BudgetRead, CurrencyRead, TransactionRead } from '../api/ff3/types';
import { referenceAccounts, referenceCategories, referenceBudgets, referenceCurrencies, cachedTransactions } from '../db/schema';
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

  await pullRecentTransactions(db, client, now);
}

// Feeds cachedTransactions, which src/sync/outbox.ts's conflict check and
// src/lookup/merchantLookup.ts's suggestion history both read — without this nothing ever
// populates that table and both go silently inert.
export async function pullRecentTransactions(db: OutboxDb, client: FF3Client, syncedAt: string): Promise<void> {
  const start = new Date();
  start.setMonth(start.getMonth() - 3);
  const startDate = start.toISOString().slice(0, 10);

  // ponytail: caps at 20 pages (~2000 txns at limit=100); raise if real history exceeds that.
  for (let page = 1; page <= 20; page++) {
    const response = await client.request<{ data: TransactionRead[] }>(
      `/v1/transactions?start=${startDate}&limit=100&page=${page}`,
    );
    if (response.data.length === 0) break;

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
        updatedAt: journal.updated_at,
        syncedAt,
      };
      await db.insert(cachedTransactions).values(row).onConflictDoUpdate({ target: cachedTransactions.groupId, set: row });
    }

    if (response.data.length < 100) break;
  }
}
