import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createTestDb } from '../db/testDb';
import { referenceCurrencies } from '../db/schema';
import { usePlannedForm } from './usePlannedForm';
import type { PlannedItem } from './items';
import type { MerchantHistory } from '../lookup/merchantLookup';

let mockDb: ReturnType<typeof createTestDb>;
jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

const mockAccounts = [
  { id: '1', name: 'Checking', type: 'asset', currencyCode: 'PLN' },
  { id: '2', name: 'Savings', type: 'asset', currencyCode: 'EUR' },
];
jest.mock('../accounts/useAssetAccounts', () => ({
  useAssetAccounts: () => mockAccounts,
}));

jest.mock('../db/useReferenceData', () => ({
  useAssetAccounts: () => mockAccounts,
  useCategories: () => [
    { id: '1', name: 'Housing' },
    { id: '2', name: 'Groceries' },
  ],
  useCurrencyRows: () => [
    { code: 'PLN', symbol: 'zł', decimalPlaces: 2 },
    { code: 'EUR', symbol: '€', decimalPlaces: 2 },
  ],
}));

jest.mock('../lookup/useMerchantHistories', () => ({
  useMerchantHistories: () => [],
}));

jest.mock('../settings/appSettings', () => ({
  getDefaultSourceAccountId: jest.fn(async () => '1'),
  getDefaultCurrencyCode: jest.fn(async () => 'PLN'),
}));

describe('usePlannedForm', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockDb = createTestDb();
    await mockDb.insert(referenceCurrencies).values([
      {
        code: 'PLN',
        symbol: 'zł',
        decimalPlaces: 2,
        enabled: true,
        isDefault: true,
        syncedAt: '2026-10-01T00:00:00Z',
      },
      {
        code: 'EUR',
        symbol: '€',
        decimalPlaces: 2,
        enabled: true,
        isDefault: false,
        syncedAt: '2026-10-01T00:00:00Z',
      },
    ]);
  });

  it('default-fills source account and currency for a new planned payment', async () => {
    const { result } = await renderHook(() => usePlannedForm(null));

    await waitFor(() => {
      expect(result.current?.fields.sourceId).toBe('1');
      expect(result.current?.fields.currencyCode).toBe('PLN');
    });
  });

  it('does not overwrite existing fields for an existing planned payment', async () => {
    const existing: PlannedItem = {
      key: 'existing',
      queued: false,
      fields: {
        name: 'Existing',
        type: 'withdrawal',
        sourceId: '2',
        sourceName: 'Savings',
        destinationId: null,
        destinationName: 'Landlord',
        amount: '100',
        currencyCode: 'EUR',
        notes: null,
        repeats: true,
        repetitions: [{ type: 'monthly', moment: '1', skip: 0, weekend: 1 }],
        end: { kind: 'forever' },
        date: '2026-10-01',
        time: null,
        skipDays: [],
        categoryName: 'Housing',
        tags: [],
      },
      group: null,
    };

    const { result } = await renderHook(() => usePlannedForm(existing));

    expect(result.current?.fields.sourceId).toBe('2');
    expect(result.current?.fields.currencyCode).toBe('EUR');
    expect(result.current?.fields.name).toBe('Existing');
  });

  it('changeType moves the own account when switching withdrawal <-> deposit', async () => {
    const { result } = await renderHook(() => usePlannedForm(null));
    await waitFor(() => expect(result.current?.fields.currencyCode).toBe('PLN'));

    await act(async () => {
      result.current?.set({
        sourceId: '1',
        sourceName: 'Checking',
        destinationId: null,
        destinationName: 'Store',
      });
    });

    // Change withdrawal -> deposit: own account moves from source to destination
    await act(async () => {
      result.current?.changeType('deposit');
    });

    expect(result.current?.fields.type).toBe('deposit');
    expect(result.current?.fields.destinationId).toBe('1');
    expect(result.current?.fields.destinationName).toBe('Checking');
    expect(result.current?.fields.sourceId).toBeNull();
    expect(result.current?.fields.sourceName).toBeNull();

    // Change deposit -> withdrawal: own account moves from destination back to source
    await act(async () => {
      result.current?.changeType('withdrawal');
    });

    expect(result.current?.fields.type).toBe('withdrawal');
    expect(result.current?.fields.sourceId).toBe('1');
    expect(result.current?.fields.sourceName).toBe('Checking');
    expect(result.current?.fields.destinationId).toBeNull();
    expect(result.current?.fields.destinationName).toBeNull();
  });

  describe('choosePayee and chosen flags', () => {
    const history: MerchantHistory = {
      merchantKey: 'landlord',
      displayName: 'Landlord',
      occurrences: 5,
      lastUsed: '2026-10-01',
      topCategory: 'Housing',
      topAccountName: 'Savings',
      topBudgetName: null,
    };

    it('fills suggested category and account when neither was chosen by hand', async () => {
      const { result } = await renderHook(() => usePlannedForm(null));
      await waitFor(() => expect(result.current?.fields.currencyCode).toBe('PLN'));

      await act(async () => {
        result.current?.choosePayee(history);
      });

      expect(result.current?.fields.destinationName).toBe('Landlord');
      expect(result.current?.fields.categoryName).toBe('Housing');
      expect(result.current?.fields.sourceId).toBe('2');
      expect(result.current?.fields.sourceName).toBe('Savings');
    });

    it('respects chosen account and does not overwrite it from history', async () => {
      const { result } = await renderHook(() => usePlannedForm(null));
      await waitFor(() => expect(result.current?.fields.currencyCode).toBe('PLN'));

      // User chooses account by hand
      await act(async () => {
        result.current?.setChosen((c) => ({ ...c, account: true }));
        result.current?.set({ sourceId: '1', sourceName: 'Checking' });
      });

      await act(async () => {
        result.current?.choosePayee(history);
      });

      // Payee is set, category is filled from history, but account remains Checking!
      expect(result.current?.fields.destinationName).toBe('Landlord');
      expect(result.current?.fields.categoryName).toBe('Housing');
      expect(result.current?.fields.sourceId).toBe('1');
      expect(result.current?.fields.sourceName).toBe('Checking');
    });

    it('respects chosen category and does not overwrite it from history', async () => {
      const { result } = await renderHook(() => usePlannedForm(null));
      await waitFor(() => expect(result.current?.fields.currencyCode).toBe('PLN'));

      // User chooses category by hand
      await act(async () => {
        result.current?.setChosen((c) => ({ ...c, category: true }));
        result.current?.set({ categoryName: 'Groceries' });
      });

      await act(async () => {
        result.current?.choosePayee(history);
      });

      // Payee is set, account is filled from history, but category remains Groceries!
      expect(result.current?.fields.destinationName).toBe('Landlord');
      expect(result.current?.fields.categoryName).toBe('Groceries');
      expect(result.current?.fields.sourceId).toBe('2');
      expect(result.current?.fields.sourceName).toBe('Savings');
    });
  });
});
