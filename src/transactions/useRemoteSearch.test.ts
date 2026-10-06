import { buildRemoteSearchQuery, filterRemoteRows } from './useRemoteSearch';
import type { RemoteResultRow } from './activityRows';
import type { TransactionRead } from '../api/ff3/types';

describe('buildRemoteSearchQuery', () => {
  it('leaves query unchanged when type is all and no account is specified', () => {
    expect(buildRemoteSearchQuery('coffee', 'all')).toBe('coffee');
    expect(buildRemoteSearchQuery('   coffee   ', 'all')).toBe('coffee');
  });

  it('appends type filter for withdrawal, deposit, transfer', () => {
    expect(buildRemoteSearchQuery('coffee', 'withdrawal')).toBe('coffee type:withdrawal');
    expect(buildRemoteSearchQuery('salary', 'deposit')).toBe('salary type:deposit');
    expect(buildRemoteSearchQuery('savings', 'transfer')).toBe('savings type:transfer');
  });

  it('appends account_id filter when specified', () => {
    expect(buildRemoteSearchQuery('coffee', 'all', '42')).toBe('coffee account_id:42');
    expect(buildRemoteSearchQuery('coffee', 'withdrawal', '42')).toBe(
      'coffee type:withdrawal account_id:42',
    );
  });

  it('does not duplicate type or account_id if already present in query', () => {
    expect(buildRemoteSearchQuery('coffee type:withdrawal', 'withdrawal')).toBe(
      'coffee type:withdrawal',
    );
    expect(buildRemoteSearchQuery('coffee account_id:42', 'withdrawal', '42')).toBe(
      'coffee account_id:42 type:withdrawal',
    );
  });
});

describe('filterRemoteRows', () => {
  function makeRow(
    groupId: string,
    type: 'withdrawal' | 'deposit' | 'transfer',
    sourceId: string | null = '1',
    destinationId: string | null = '2',
    extraSplits: { sourceId?: string; destinationId?: string }[] = [],
  ): RemoteResultRow {
    const transactions = [
      {
        transaction_journal_id: `j${groupId}-1`,
        type,
        date: '2026-03-01',
        amount: '10.00',
        description: `Test ${groupId}`,
        source_id: sourceId ?? undefined,
        destination_id: destinationId ?? undefined,
        updated_at: '2026-03-01T00:00:00Z',
      },
      ...extraSplits.map((s, idx) => ({
        transaction_journal_id: `j${groupId}-${idx + 2}`,
        type,
        date: '2026-03-01',
        amount: '5.00',
        description: `Split ${idx + 2}`,
        source_id: s.sourceId,
        destination_id: s.destinationId,
        updated_at: '2026-03-01T00:00:00Z',
      })),
    ];

    const group: TransactionRead = {
      id: groupId,
      attributes: {
        transactions,
      },
    };

    return {
      remote: true,
      group,
      groupId,
      description: `Test ${groupId}`,
      amount: '10.00',
      currencyCode: 'PLN',
      type,
      sourceId,
      destinationId,
      sourceName: 'Source',
      destinationName: 'Destination',
      categoryName: 'Category',
    };
  }

  it('filters out transfers and deposits when filtered by withdrawal', () => {
    const rows = [
      makeRow('1', 'withdrawal'),
      makeRow('2', 'transfer'),
      makeRow('3', 'deposit'),
      makeRow('4', 'withdrawal'),
    ];

    const filtered = filterRemoteRows(rows, 'withdrawal');
    expect(filtered.map((r) => r.groupId)).toEqual(['1', '4']);
  });

  it('filters out withdrawals and transfers when filtered by deposit', () => {
    const rows = [makeRow('1', 'withdrawal'), makeRow('2', 'transfer'), makeRow('3', 'deposit')];

    const filtered = filterRemoteRows(rows, 'deposit');
    expect(filtered.map((r) => r.groupId)).toEqual(['3']);
  });

  it('filters out withdrawals and deposits when filtered by transfer', () => {
    const rows = [makeRow('1', 'withdrawal'), makeRow('2', 'transfer'), makeRow('3', 'deposit')];

    const filtered = filterRemoteRows(rows, 'transfer');
    expect(filtered.map((r) => r.groupId)).toEqual(['2']);
  });

  it('preserves all rows when type is all', () => {
    const rows = [makeRow('1', 'withdrawal'), makeRow('2', 'transfer'), makeRow('3', 'deposit')];

    const filtered = filterRemoteRows(rows, 'all');
    expect(filtered.map((r) => r.groupId)).toEqual(['1', '2', '3']);
  });

  it('filters rows by accountId on primary leg or secondary split leg', () => {
    const rowSourceMatch = makeRow('1', 'withdrawal', '10', '20');
    const rowDestMatch = makeRow('2', 'withdrawal', '5', '10');
    const rowNoMatch = makeRow('3', 'withdrawal', '5', '20');
    const rowSplitMatch = makeRow('4', 'withdrawal', '5', '20', [{ destinationId: '10' }]);

    const rows = [rowSourceMatch, rowDestMatch, rowNoMatch, rowSplitMatch];

    const filtered = filterRemoteRows(rows, 'withdrawal', '10');
    expect(filtered.map((r) => r.groupId)).toEqual(['1', '2', '4']);
  });
});
