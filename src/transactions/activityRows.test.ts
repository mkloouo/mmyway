import { mapRemoteResult } from './activityRows';
import type { TransactionRead } from '../api/ff3/types';

describe('mapRemoteResult', () => {
  it('maps single split transaction and preserves sourceId and destinationId', () => {
    const group: TransactionRead = {
      id: '123',
      attributes: {
        transactions: [
          {
            transaction_journal_id: 'j1',
            type: 'withdrawal',
            date: '2026-03-01',
            amount: '12.50',
            currency_code: 'EUR',
            description: 'Bakery',
            source_id: '5',
            destination_id: '20',
            source_name: 'Checking',
            destination_name: 'Bakery Store',
            category_name: 'Food',
            updated_at: '2026-03-01T00:00:00Z',
          },
        ],
      },
    };

    const row = mapRemoteResult(group);
    expect(row).toEqual({
      remote: true,
      group,
      groupId: '123',
      description: 'Bakery',
      amount: '12.50',
      currencyCode: 'EUR',
      type: 'withdrawal',
      sourceId: '5',
      destinationId: '20',
      sourceName: 'Checking',
      destinationName: 'Bakery Store',
      categoryName: 'Food',
    });
  });

  it('aggregates splits with the same currency and uses group_title if present', () => {
    const group: TransactionRead = {
      id: '456',
      attributes: {
        group_title: 'Supermarket Run',
        transactions: [
          {
            transaction_journal_id: 'j1',
            type: 'withdrawal',
            date: '2026-03-01',
            amount: '10.00',
            currency_code: 'EUR',
            description: 'Groceries',
            source_id: '5',
            destination_id: '30',
            updated_at: '2026-03-01T00:00:00Z',
          },
          {
            transaction_journal_id: 'j2',
            type: 'withdrawal',
            date: '2026-03-01',
            amount: '5.50',
            currency_code: 'EUR',
            description: 'Household',
            source_id: '5',
            destination_id: '30',
            updated_at: '2026-03-01T00:00:00Z',
          },
        ],
      } as any,
    };

    const row = mapRemoteResult(group);
    expect(row).toEqual({
      remote: true,
      group,
      groupId: '456',
      description: 'Supermarket Run',
      amount: '15.50',
      currencyCode: 'EUR',
      type: 'withdrawal',
      sourceId: '5',
      destinationId: '30',
      sourceName: null,
      destinationName: null,
      categoryName: null,
    });
  });

  it('returns null if group has no transactions', () => {
    const group: TransactionRead = {
      id: '789',
      attributes: {
        transactions: [],
      },
    };
    expect(mapRemoteResult(group)).toBeNull();
  });
});
