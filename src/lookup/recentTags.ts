// Suggestions for the tags field: most recent user tags across cached transactions.
import { notLike } from 'drizzle-orm';
import { useMemo } from 'react';
import { cachedTransactions } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';
import { isUserTag, parseTags } from '../transactions/tags';

const MOST = 10;

/** Pure half, for tests: the user tags in these rows, most recently used first. */
export function recentTagsFrom(rows: { tagsJson: string; date: string }[]): string[] {
  const seen = new Map<string, { tag: string; date: string }>();
  for (const row of rows) {
    for (const tag of parseTags(row.tagsJson)) {
      if (!isUserTag(tag)) continue;
      const key = tag.toLowerCase();
      const known = seen.get(key);
      if (!known || row.date > known.date) {
        seen.set(key, { tag, date: row.date });
      }
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.date.localeCompare(a.date) || a.tag.localeCompare(b.tag))
    .slice(0, MOST)
    .map((p) => p.tag);
}

export function useRecentTags(): string[] {
  const db = useDb();
  const { data } = useLiveQuery(
    db
      .select({ tagsJson: cachedTransactions.tagsJson, date: cachedTransactions.date })
      .from(cachedTransactions)
      .where(notLike(cachedTransactions.tagsJson, '[]')),
  );
  return useMemo(() => recentTagsFrom(data ?? []), [data]);
}
