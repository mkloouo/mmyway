// Pages cached transactions instead of reading the whole table and filtering in JS on every
// keystroke (design §6.4) — three months of history is thousands of rows. Search and type both
// push into the SQL so a match outside the loaded window is still found.
import { useMemo, useState } from 'react';
import { and, desc, eq, like, or } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useDb } from '../providers/DbProvider';
import { cachedTransactions } from '../db/schema';
import { groupByDay, type DaySection, type DayTransaction } from './groupByDay';

const PAGE_SIZE = 100;

export type ActivityTypeFilter = 'all' | 'withdrawal' | 'deposit' | 'transfer';
// cached_transactions.type is a plain text column (no DB-level enum) — narrowed here since every
// write path (referenceData.ts) only ever writes one of the three FF3 transaction types into it.
export type CachedTransactionRow = Omit<typeof cachedTransactions.$inferSelect, 'type'> & DayTransaction;

export interface UseTransactionPageResult {
  sections: DaySection<CachedTransactionRow>[];
  loadMore: () => void;
  loadingMore: boolean;
  atEnd: boolean;
}

export function useTransactionPage(
  { search, type, accountName }: { search: string; type: ActivityTypeFilter; accountName?: string | null },
): UseTransactionPageResult {
  const db = useDb();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const trimmed = search.trim();
  // Resets the page size when the filter changes — adjusted during render (React's documented
  // pattern for "resetting state when a prop changes"), not in an effect, so there is no extra
  // commit+repaint between the filter changing and the page resetting.
  const filterKey = `${type}:${accountName ?? ''}:${trimmed}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setLimit(PAGE_SIZE);
  }

  const conditions = [];
  if (type !== 'all') conditions.push(eq(cachedTransactions.type, type));
  if (trimmed) {
    const pattern = `%${trimmed}%`;
    conditions.push(or(
      like(cachedTransactions.description, pattern),
      like(cachedTransactions.sourceName, pattern),
      like(cachedTransactions.destinationName, pattern),
    )!);
  }
  if (accountName) {
    conditions.push(or(
      eq(cachedTransactions.sourceName, accountName),
      eq(cachedTransactions.destinationName, accountName),
    )!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const base = db.select().from(cachedTransactions).orderBy(desc(cachedTransactions.date)).limit(limit + 1);
  // useLiveQuery runs its query in an effect whose dep list defaults to `[]` — without these deps
  // it keeps re-running the query built on the first render, so changing the filter, typing in
  // search or paging past the first 100 rows all silently returned the same rows.
  const { data } = useLiveQuery(where ? base.where(where) : base, [filterKey, limit]);

  const rows = data ?? [];
  const atEnd = rows.length <= limit;
  const visible = atEnd ? rows : rows.slice(0, limit);

  // Same render-time-adjustment pattern: new data means the page load this component is waiting
  // on has landed (a local SQLite read, effectively instant), so the spinner clears immediately.
  const [prevData, setPrevData] = useState(data);
  if (data !== prevData) {
    setPrevData(data);
    if (loadingMore) setLoadingMore(false);
  }

  const sections = useMemo(() => groupByDay(visible as unknown as CachedTransactionRow[]), [visible]);

  function loadMore() {
    if (atEnd || loadingMore) return;
    setLoadingMore(true);
    setLimit((l) => l + PAGE_SIZE);
  }

  return { sections, loadMore, loadingMore, atEnd };
}
