// Computes which accounts were used in cached transactions in a given calendar year.
// Pure functions, offline, zero native dependencies.

export interface TransactionAccountRef {
  date: string; // ISO 8601 string
  sourceId?: string | null;
  destinationId?: string | null;
}

/**
 * Returns a Set of account IDs that appear as either source or destination in any transaction
 * dated within the given calendar year (defaults to the current year).
 */
export function getUsedAccountIdsThisYear(
  transactions: readonly TransactionAccountRef[],
  year: number = new Date().getFullYear(),
): Set<string> {
  const yearPrefix = `${year}-`;
  const used = new Set<string>();
  for (const tx of transactions) {
    if (tx.date && tx.date.startsWith(yearPrefix)) {
      if (tx.sourceId) used.add(tx.sourceId);
      if (tx.destinationId) used.add(tx.destinationId);
    }
  }
  return used;
}

/**
 * Filters a list of accounts to only those whose ID is in the set of used account IDs.
 */
export function filterAccountsUsedThisYear<T extends { id: string }>(
  accounts: readonly T[],
  usedAccountIds: ReadonlySet<string>,
): T[] {
  return accounts.filter((a) => usedAccountIds.has(a.id));
}
