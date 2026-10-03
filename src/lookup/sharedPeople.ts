// Who the user shares things with, for the suggestion chips under "Shared with".
//
// There is nothing new to store and nothing to ask Firefly III: every person is already on the
// phone as a `mmyway-shared-<name>` tag on a cached transaction, synced like any other field. So
// the list is read back out of the transaction cache, which also means it survives a reinstall
// (the next sync brings it back) and can't drift from what Firefly III actually holds.
import { like } from 'drizzle-orm';
import { useMemo } from 'react';
import { cachedTransactions } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';
import { SHARED_TAG_PREFIX, sharedNamesFromTags } from '../transactions/sharedWith';

/** At most this many chips: the row is a reminder of who you share with, not a contact list. */
const MOST = 8;

function parseTags(tagsJson: string): string[] {
  try {
    const tags: unknown = JSON.parse(tagsJson);
    return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return []; // suggestions only: a row that can't be read just doesn't contribute
  }
}

/** Pure half, for tests: the people in these rows, the most recently shared with first. */
export function sharedPeopleFrom(rows: { tagsJson: string; date: string }[]): string[] {
  // Keyed case-insensitively so "Anna" and "anna" are one person, shown the way the latest
  // transaction spells them.
  const seen = new Map<string, { name: string; date: string }>();
  for (const row of rows)
    for (const name of sharedNamesFromTags(parseTags(row.tagsJson))) {
      const key = name.toLowerCase();
      const known = seen.get(key);
      if (!known || row.date > known.date) seen.set(key, { name, date: row.date });
    }
  return [...seen.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MOST)
    .map((p) => p.name);
}

/**
 * Most recently shared with first. Live, so a sync that brings in a new person shows them without
 * reopening the screen. Someone named only on a draft that hasn't synced yet isn't here — they
 * arrive once their transaction does.
 */
export function useSharedPeople(): string[] {
  const db = useDb();
  const { data } = useLiveQuery(
    db
      .select({ tagsJson: cachedTransactions.tagsJson, date: cachedTransactions.date })
      .from(cachedTransactions)
      // Narrowed in SQL: most transactions are shared with nobody, so only a handful of rows
      // come back to be parsed, rather than the whole cache on every render.
      .where(like(cachedTransactions.tagsJson, `%${SHARED_TAG_PREFIX}%`)),
  );
  return useMemo(() => sharedPeopleFrom(data ?? []), [data]);
}
