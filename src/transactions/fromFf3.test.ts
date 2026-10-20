import type { TransactionRead } from '../api/ff3/types';
import {
  cachedRowFromGroup,
  editableSplitFromCached,
  groupHeadline,
  groupTypeOf,
  searchKeyOf,
  splitLineFromCached,
} from './fromFf3';
import type { CachedSplit } from './splitsJson';

describe('src/transactions/fromFf3', () => {
  const singleSplitGroup = {
    id: 'grp-1',
    type: 'transactions',
    attributes: {
      updated_at: '2026-03-05T10:00:00Z',
      transactions: [
        {
          transaction_journal_id: 'j-1',
          updated_at: '2026-03-05T10:00:00Z',
          type: 'withdrawal',
          date: '2026-03-05',
          amount: '12.50',
          currency_code: 'EUR',
          description: 'Coffee',
          source_name: 'Checking',
          source_id: '10',
          destination_name: 'Cafe',
          destination_id: '20',
          category_name: 'Food',
          tags: ['food', 'morning'],
          notes: 'Espresso',
        },
      ],
    },
  };

  const multiSplitGroup = {
    id: 'grp-2',
    type: 'transactions',
    attributes: {
      group_title: 'Supermarket Trip',
      updated_at: '2026-03-05T12:00:00Z',
      transactions: [
        {
          transaction_journal_id: 'j-2a',
          updated_at: '2026-03-05T12:00:00Z',
          type: 'withdrawal',
          date: '2026-03-05',
          amount: '30.00',
          currency_code: 'EUR',
          description: 'Groceries',
          source_name: 'Checking',
          source_id: '10',
          destination_name: 'Supermarket',
          destination_id: '30',
          category_name: 'Groceries',
        },
        {
          transaction_journal_id: 'j-2b',
          updated_at: '2026-03-05T12:00:00Z',
          type: 'withdrawal',
          date: '2026-03-05',
          amount: '15.00',
          currency_code: 'EUR',
          description: 'Cleaning Supplies',
          source_name: 'Checking',
          source_id: '10',
          destination_name: 'Supermarket',
          destination_id: '30',
          category_name: 'Household',
        },
      ],
    },
  };

  it('extracts groupTypeOf correctly', () => {
    expect(groupTypeOf(singleSplitGroup as unknown as TransactionRead)).toBe('withdrawal');
    expect(groupTypeOf({ attributes: { transactions: [] } } as any)).toBeUndefined();
  });

  it('extracts groupHeadline for single and multi-split groups', () => {
    expect(groupHeadline(singleSplitGroup as unknown as TransactionRead)).toEqual({
      amount: '12.50',
      description: 'Coffee',
    });
    expect(groupHeadline(multiSplitGroup as unknown as TransactionRead)).toEqual({
      amount: '45.00',
      description: 'Supermarket Trip',
    });
  });

  it('maps group to cachedRowFromGroup', () => {
    const row = cachedRowFromGroup(
      singleSplitGroup as unknown as TransactionRead,
      '2026-03-05T10:05:00Z',
    );
    expect(row).not.toBeNull();
    expect(row?.groupId).toBe('grp-1');
    expect(row?.journalId).toBe('j-1');
    expect(row?.amount).toBe('12.50');
    expect(row?.currencyCode).toBe('EUR');
    expect(row?.description).toBe('Coffee');
    expect(row?.categoryName).toBe('Food');
    expect(row?.sourceId).toBe('10');
    expect(row?.destinationId).toBe('20');
    expect(row?.splitCount).toBe(1);
    expect(row?.updatedAt).toBe('2026-03-05T10:00:00Z');
    expect(row?.syncedAt).toBe('2026-03-05T10:05:00Z');
  });

  it('returns null from cachedRowFromGroup when no transactions exist', () => {
    expect(
      cachedRowFromGroup({ id: '1', attributes: { transactions: [] } } as any, 'now'),
    ).toBeNull();
  });

  it('maps splitLineFromCached and editableSplitFromCached', () => {
    const split: CachedSplit = {
      journalId: 'j-1',
      amount: '25.00',
      description: 'Dinner',
      sourceId: '1',
      sourceName: 'Bank',
      destinationId: '2',
      destinationName: 'Restaurant',
      categoryName: 'Dining',
      budgetId: null,
      budgetName: null,
      notes: null,
      tags: ['fun'],
      foreignAmount: null,
      foreignCurrencyCode: null,
      internalReference: 'mmyway:c1',
    };

    expect(splitLineFromCached(split)).toEqual({
      label: 'Dining',
      amount: '25.00',
      categoryName: 'Dining',
    });

    const editable = editableSplitFromCached(split);
    expect(editable.journalId).toBe('j-1');
    expect(editable.amount).toBe('25.00');
    expect(editable.internalReference).toBe('mmyway:c1');
  });

  it('constructs searchKeyOf normalized by parts', () => {
    expect(searchKeyOf(['Coffee', 'Cafe'])).toContain('coffee|cafe');
  });
});
