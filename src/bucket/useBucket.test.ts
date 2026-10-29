import { renderHook } from '@testing-library/react-native';
import { createTestDb } from '../db/testDb';
import {
  bucketObjects,
  referenceAccounts,
  referenceBudgets,
  referenceCurrencies,
} from '../db/schema';
import { storePlanned } from '../planned/objects';
import { bucketRow } from './objects';
import { useBucket } from './useBucket';

let mockDb: ReturnType<typeof createTestDb>;
jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));
jest.mock('../db/useLiveQuery', () => ({
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

it('sums Ready to Assign only in the displayed currency, without mixing foreign balances or allocations', async () => {
  mockDb = createTestDb();
  await mockDb
    .insert(referenceCurrencies)
    .values({ code: 'PLN', symbol: 'zł', decimalPlaces: 2, isDefault: true, syncedAt: 'now' });
  for (const code of ['PLN', 'EUR']) {
    await mockDb.insert(referenceAccounts).values({
      id: code,
      name: code,
      type: 'asset',
      currencyCode: code,
      currentBalance: '100.00',
      active: true,
      syncedAt: 'now',
    });
    await mockDb
      .insert(referenceBudgets)
      .values({ id: code, name: code, active: true, syncedAt: 'now' });
    await mockDb
      .insert(bucketObjects)
      .values([
        bucketRow(
          'budget_limit',
          code,
          '2026-10-01',
          { id: code, currency_code: code, amount: '20.00', spent: '-5.00' },
          'now',
        ),
        bucketRow(
          'piggy',
          code,
          null,
          { name: code, currency_code: code, current_amount: '10.00' },
          'now',
        ),
      ]);
    await storePlanned(mockDb, 'bill', code, {
      name: code,
      currency_code: code,
      amount_max: '5.00',
      next_expected_match: '2026-10-29',
      active: true,
    });
  }
  const { result } = await renderHook(() => useBucket({ start: '2026-10-01', end: '2026-10-31' }));
  expect(result.current.currencyCode).toBe('PLN');
  expect(result.current.rta).toEqual({
    cash: '100.00',
    envelopes: '15.00',
    funds: '10.00',
    bills: '5.00',
    allocated: '30.00',
    readyToAssign: '70.00',
  });
});
