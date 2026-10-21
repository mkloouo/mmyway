import { buildDisplaySections, getSearchFooter } from './buildDisplaySections';
import type { ActivityItem, QueuedRow, RemoteResultRow } from './activityRows';
import { REMOTE_SECTION_KEY } from './activityRows';
import type { CachedTransactionRow } from './useTransactionPage';
import type { DaySection } from './groupByDay';

describe('buildDisplaySections', () => {
  const emptyEdits = { byGroup: new Map(), byJournal: new Map() };
  const mockRowKey = (r: ActivityItem) =>
    'inboxItemId' in r && r.inboxItemId ? `inbox:${r.inboxItemId}` : r.groupId;

  it('filters pending deletes and applies sections', () => {
    const sections: DaySection<CachedTransactionRow>[] = [
      {
        key: '2026-10-10',
        totals: [],
        data: [
          {
            groupId: 'grp-1',
            journalId: 'j-1',
            description: 'Item 1',
            amount: '10.00',
            currencyCode: 'PLN',
            type: 'withdrawal',
            categoryName: null,
            sourceName: null,
            destinationName: null,
          },
          {
            groupId: 'grp-2',
            journalId: 'j-2',
            description: 'Item 2',
            amount: '20.00',
            currencyCode: 'PLN',
            type: 'withdrawal',
            categoryName: null,
            sourceName: null,
            destinationName: null,
          },
        ] as any,
      },
    ];

    const result = buildDisplaySections({
      sections,
      queuedRows: [],
      sentItems: null,
      cacheFacts: null,
      pendingDeletes: new Set(['grp-1']),
      edits: emptyEdits,
      rowKey: mockRowKey,
      type: 'all',
      accountFilter: null,
      search: '',
      remoteRows: null,
      todayKey: '2026-10-10',
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.data).toHaveLength(1);
    expect(result[0]!.data[0]!.groupId).toBe('grp-2');
  });

  it('prepends pinned queued rows to today section', () => {
    const queued: QueuedRow = {
      queued: true,
      groupId: 'q-1',
      inboxItemId: 'inbox-1',
      description: 'Coffee',
      amount: '5.00',
      currencyCode: 'PLN',
      type: 'withdrawal',
      sourceId: null,
      destinationId: null,
      sourceName: null,
      destinationName: null,
      categoryName: null,
      splits: [],
    };

    const sections: DaySection<CachedTransactionRow>[] = [
      {
        key: '2026-10-10',
        totals: [],
        data: [
          {
            groupId: 'grp-2',
            journalId: 'j-2',
            description: 'Item 2',
            amount: '20.00',
            currencyCode: 'PLN',
            type: 'withdrawal',
            categoryName: null,
            sourceName: null,
            destinationName: null,
          },
        ] as any,
      },
    ];

    const result = buildDisplaySections({
      sections,
      queuedRows: [queued],
      sentItems: null,
      cacheFacts: null,
      pendingDeletes: new Set(),
      edits: emptyEdits,
      rowKey: mockRowKey,
      type: 'all',
      accountFilter: null,
      search: '',
      remoteRows: null,
      todayKey: '2026-10-10',
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.data).toHaveLength(2);
    expect(result[0]!.data[0]!.groupId).toBe('q-1');
  });

  it('adds remote search section if remote rows exist and are not already in local results', () => {
    const remote: RemoteResultRow = {
      remote: true,
      groupId: 'remote-1',
      description: 'Old transaction',
      amount: '50.00',
      currencyCode: 'PLN',
      type: 'withdrawal',
      sourceId: null,
      destinationId: null,
      sourceName: null,
      destinationName: null,
      categoryName: null,
      group: {} as any,
    };

    const result = buildDisplaySections({
      sections: [],
      queuedRows: [],
      sentItems: null,
      cacheFacts: null,
      pendingDeletes: new Set(),
      edits: emptyEdits,
      rowKey: mockRowKey,
      type: 'all',
      accountFilter: null,
      search: '',
      remoteRows: [remote],
      todayKey: '2026-10-10',
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe(REMOTE_SECTION_KEY);
    expect(result[0]!.data[0]!.groupId).toBe('remote-1');
  });
});

describe('getSearchFooter', () => {
  it('returns appropriate search footer message based on status', () => {
    expect(getSearchFooter('loading', false)).toEqual({ key: 'activity.searching' });
    expect(getSearchFooter('offline', false)).toEqual({ key: 'activity.searchOffline' });
    expect(getSearchFooter('error', false)).toEqual({ key: 'activity.searchFailed', warn: true });
    expect(getSearchFooter('done', false)).toEqual({ key: 'activity.nothingMore' });
    expect(getSearchFooter('done', true)).toBeNull();
    expect(getSearchFooter('idle', false)).toBeNull();
  });
});
