import { inArray, max } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { cachedTransactions } from '../db/schema';
import { landingItems, matchesActivityFilter } from './pinnedRows';

const sent = (id: string, groupId: string, updatedAt: string, kind = 'manual_entry') => ({
  id,
  kind,
  ff3GroupId: groupId,
  updatedAt,
});

describe('landingItems', () => {
  const items = [
    sent('new', 'g-new', '2026-09-28T12:00:00Z'),
    sent('old', 'g-deleted-in-ff3', '2026-03-01T12:00:00Z'),
    sent('cached', 'g-cached', '2026-09-28T12:00:00Z'),
    sent('review', 'g-review', '2026-09-28T12:00:00Z', 'recurring_review'),
  ];
  const cache = { groupIds: new Set(['g-cached']), caughtUpAt: '2026-09-28T11:00:00Z' };

  it('keeps only entries sent after the cache caught up and not in it', () => {
    expect(landingItems(items, cache, new Set()).map((i) => i.id)).toEqual(['new']);
  });

  it('never pins an entry deleted in FF3 long ago, whatever is filtered', () => {
    // The bug: an account with no cached rows made "caught up" never, so every sent entry pinned.
    expect(landingItems(items, cache, new Set()).some((i) => i.id === 'old')).toBe(false);
  });

  it('pins nothing while the cache state is unknown or the cache was never filled', () => {
    expect(landingItems(items, null, new Set())).toEqual([]);
    expect(landingItems(items, { groupIds: new Set(), caughtUpAt: null }, new Set())).toEqual([]);
  });

  it('leaves out an entry that is still queued (its queued row shows instead)', () => {
    expect(landingItems(items, cache, new Set(['new']))).toEqual([]);
  });
});

describe('matchesActivityFilter', () => {
  const row = {
    type: 'withdrawal' as const,
    sourceId: '1',
    destinationId: '9',
    description: 'Coffee',
    sourceName: 'PKO',
    destinationName: 'Żabka',
  };
  const all = { type: 'all' as const, accountId: null, search: '' };

  it('passes everything with no filter', () => {
    expect(matchesActivityFilter(row, all)).toBe(true);
  });

  it('filters by account, on either end', () => {
    expect(matchesActivityFilter(row, { ...all, accountId: '1' })).toBe(true);
    expect(matchesActivityFilter(row, { ...all, accountId: '9' })).toBe(true);
    expect(matchesActivityFilter(row, { ...all, accountId: '2' })).toBe(false);
  });

  it('filters by type and by search, folding case and accents', () => {
    expect(matchesActivityFilter(row, { ...all, type: 'deposit' })).toBe(false);
    expect(matchesActivityFilter(row, { ...all, search: 'zabka' })).toBe(true);
    expect(matchesActivityFilter(row, { ...all, search: 'rent' })).toBe(false);
  });
});

describe('the cache queries Activity runs for it', () => {
  it('accept an empty id list and an empty table', async () => {
    const db = createTestDb();
    expect(
      await db
        .select({ id: cachedTransactions.groupId })
        .from(cachedTransactions)
        .where(inArray(cachedTransactions.groupId, [])),
    ).toEqual([]);
    expect(
      await db.select({ at: max(cachedTransactions.syncedAt) }).from(cachedTransactions),
    ).toEqual([{ at: null }]);
  });
});
