// Pages cached transactions instead of reading the whole table and filtering in JS on every
// keystroke (design §6.4) — three months of history is thousands of rows. Search and type both
// push into the SQL so a match outside the loaded window is still found.
import { useMemo, useState } from 'react';
import { and, desc, eq, like, or } from 'drizzle-orm';
import { normkey } from '../lookup/normkey';
import { useLiveQuery } from '../db/useLiveQuery';
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
  /** The filter `sections` were read for; lags the requested one until its read lands. */
  dataKey: string;
  loadMore: () => void;
  loadingMore: boolean;
  atEnd: boolean;
}

export function useTransactionPage(
  { search, type, accountId }: { search: string; type: ActivityTypeFilter; accountId?: string | null },
): UseTransactionPageResult {
  const db = useDb();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const trimmed = search.trim();
  // Resets the page size when the filter changes — adjusted during render (React's documented
  // pattern for "resetting state when a prop changes"), not in an effect, so there is no extra
  // commit+repaint between the filter changing and the page resetting.
  const filterKey = `${type}:${accountId ?? ''}:${trimmed}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setLimit(PAGE_SIZE);
  }

  const conditions = [];
  if (type !== 'all') conditions.push(eq(cachedTransactions.type, type));
  // SQLite's LIKE folds case for ASCII only ("żabka" missed "Żabka"), so both sides go through
  // normkey: the query here, the row's text into search_key when it is cached.
  const key = normkey(trimmed);
  if (key) conditions.push(like(cachedTransactions.searchKey, `%${key}%`));
  // By FF3 id, not name: a renamed account, or two sharing a name, used to break the filter.
  if (accountId) {
    conditions.push(or(
      eq(cachedTransactions.sourceId, accountId),
      eq(cachedTransactions.destinationId, accountId),
    )!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const base = db.select().from(cachedTransactions).orderBy(desc(cachedTransactions.date)).limit(limit + 1);
  // useLiveQuery runs its query in an effect whose dep list defaults to `[]` — without these deps
  // it keeps re-running the query built on the first render, so changing the filter, typing in
  // search or paging past the first 100 rows all silently returned the same rows.
  const { data } = useLiveQuery(where ? base.where(where) : base, [filterKey, limit]);

  // `limit + 1` rows are read to learn whether there's more; the extra one is dropped here.
  // Memoized on the query result: slicing on every render handed groupByDay a new array each time,
  // so every render regrouped every row into new objects and no list row could skip re-rendering.
  const atEnd = (data?.length ?? 0) <= limit;
  const visible = useMemo(() => {
    const rows = data ?? [];
    return rows.length <= limit ? rows : rows.slice(0, limit);
  }, [data, limit]);

  // Same render-time-adjustment pattern: new data means the page load this component is waiting
  // on has landed (a local SQLite read, effectively instant), so the spinner clears immediately.
  // It's also the moment the rows start belonging to the current filter (useLiveQuery drops the
  // results of a query it has moved past): until then `sections` still holds the previous filter's.
  const [prevData, setPrevData] = useState(data);
  const [dataKey, setDataKey] = useState(filterKey);
  if (data !== prevData) {
    setPrevData(data);
    setDataKey(filterKey);
    if (loadingMore) setLoadingMore(false);
  }

  const sections = useMemo(() => groupByDay(visible as unknown as CachedTransactionRow[]), [visible]);

  function loadMore() {
    if (atEnd || loadingMore) return;
    setLoadingMore(true);
    setLimit((l) => l + PAGE_SIZE);
  }

  return { sections, dataKey, loadMore, loadingMore, atEnd };
}
