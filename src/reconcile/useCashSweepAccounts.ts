import { useMemo } from 'react';
import { gte, sql } from 'drizzle-orm';
import { cachedTransactions, referenceAccounts } from '../db/schema';
import { useDb } from '../providers/DbProvider';
import { useLiveQuery } from '../db/useLiveQuery';
import { getUsedAccountIdsThisYear, filterAccountsUsedThisYear } from './usedAccounts';
import type { AccountPickerAccount } from '../accounts/useAssetAccounts';

export function useCashSweepAccounts() {
  const db = useDb();
  const currentYear = new Date().getFullYear();

  const { data: allAccounts = [] } = useLiveQuery(db.select().from(referenceAccounts));

  const { data: yearTxRefs = [] } = useLiveQuery(
    db
      .select({
        date: cachedTransactions.date,
        sourceId: cachedTransactions.sourceId,
        destinationId: cachedTransactions.destinationId,
      })
      .from(cachedTransactions)
      .where(gte(sql`substr(${cachedTransactions.date}, 1, 4)`, String(currentYear))),
  );

  const usedAccountIds = useMemo(
    () => getUsedAccountIdsThisYear(yearTxRefs, currentYear),
    [yearTxRefs, currentYear],
  );

  const expenseAccounts = useMemo<AccountPickerAccount[]>(
    () => allAccounts.filter((a) => a.type === 'expense'),
    [allAccounts],
  );

  const revenueAccounts = useMemo<AccountPickerAccount[]>(
    () => allAccounts.filter((a) => a.type === 'revenue'),
    [allAccounts],
  );

  const usedExpenseAccounts = useMemo(
    () => filterAccountsUsedThisYear(expenseAccounts, usedAccountIds),
    [expenseAccounts, usedAccountIds],
  );

  const usedRevenueAccounts = useMemo(
    () => filterAccountsUsedThisYear(revenueAccounts, usedAccountIds),
    [revenueAccounts, usedAccountIds],
  );

  const matchingShortfall = useMemo(
    () =>
      expenseAccounts.find(
        (a) => /^cash shortfall$/i.test(a.name) || /shortfall|reconcil/i.test(a.name),
      ) ?? null,
    [expenseAccounts],
  );

  const matchingSurplus = useMemo(
    () =>
      revenueAccounts.find(
        (a) => /^cash surplus$/i.test(a.name) || /surplus|reconcil/i.test(a.name),
      ) ?? null,
    [revenueAccounts],
  );

  return {
    expenseAccounts,
    usedExpenseAccounts,
    revenueAccounts,
    usedRevenueAccounts,
    matchingShortfall,
    matchingSurplus,
  };
}
