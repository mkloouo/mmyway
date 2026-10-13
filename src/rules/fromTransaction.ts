import type { cachedTransactions } from '../db/schema';

type CachedRow = typeof cachedTransactions.$inferSelect;

/**
 * What the Rules page's New rule sheet starts with when a rule is made from a transaction: match
 * its payee (or its title when it has none, a transfer) and set the category and budget it has.
 */
export function ruleParamsFrom(row: CachedRow): {
  match: string;
  category: string;
  budget: string;
} {
  const payee =
    row.type === 'withdrawal'
      ? row.destinationName
      : row.type === 'deposit'
        ? row.sourceName
        : null;
  return {
    match: payee || row.description,
    category: row.categoryName ?? '',
    budget: row.budgetName ?? '',
  };
}
