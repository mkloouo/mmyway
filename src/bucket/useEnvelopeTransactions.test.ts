import { renderHook } from '@testing-library/react-native';
import { createTestDb } from '../db/testDb';
import { cachedTransactions } from '../db/schema';
import { useEnvelopeTransactions } from './useEnvelopeTransactions';
import type { Period } from './period';

let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({
  useDb: () => mockDb,
}));

jest.mock('../db/useLiveQuery', () => ({
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

const PERIOD: Period = {
  start: '2026-10-01',
  end: '2026-10-31',
};

beforeEach(() => {
  mockDb = createTestDb();
  mockDb
    .insert(cachedTransactions)
    .values([
      {
        groupId: 'g1',
        journalId: 'j1',
        type: 'withdrawal',
        date: '2026-10-10T12:00:00Z',
        amount: '40.00',
        currencyCode: 'PLN',
        description: 'Weekly shop',
        destinationName: 'Biedronka',
        budgetId: 'b1',
        budgetName: 'Groceries',
        syncedAt: '2026-10-10T12:00:00Z',
        updatedAt: '2026-10-10T12:00:00Z',
      },
      {
        groupId: 'g2',
        journalId: 'j2',
        type: 'withdrawal',
        date: '2026-10-06T19:00:00Z',
        amount: '132.00',
        currencyCode: 'PLN',
        description: 'Dinner',
        destinationName: 'Pasta Bar',
        budgetId: 'b1',
        budgetName: 'Groceries',
        syncedAt: '2026-10-06T19:00:00Z',
        updatedAt: '2026-10-06T19:00:00Z',
      },
      {
        groupId: 'g3',
        journalId: 'j3',
        type: 'withdrawal',
        date: '2026-10-05T08:00:00Z',
        amount: '23.45',
        currencyCode: 'PLN',
        description: 'Żabka snacks',
        destinationName: 'Żabka',
        budgetId: 'b1',
        budgetName: 'Groceries',
        syncedAt: '2026-10-05T08:00:00Z',
        updatedAt: '2026-10-05T08:00:00Z',
      },
      {
        groupId: 'g4',
        journalId: 'j4',
        type: 'withdrawal',
        date: '2026-10-01T08:00:00Z',
        amount: '10.00',
        currencyCode: 'PLN',
        description: 'Older snack',
        destinationName: 'Kiosk',
        budgetId: 'b1',
        budgetName: 'Groceries',
        syncedAt: '2026-10-01T08:00:00Z',
        updatedAt: '2026-10-01T08:00:00Z',
      },
      // Different envelope
      {
        groupId: 'g5',
        journalId: 'j5',
        type: 'withdrawal',
        date: '2026-10-15T12:00:00Z',
        amount: '150.00',
        currencyCode: 'PLN',
        description: 'Fuel',
        destinationName: 'Shell',
        budgetId: 'b2',
        budgetName: 'Transport',
        syncedAt: '2026-10-15T12:00:00Z',
        updatedAt: '2026-10-15T12:00:00Z',
      },
      // Outside period
      {
        groupId: 'g6',
        journalId: 'j6',
        type: 'withdrawal',
        date: '2026-09-28T12:00:00Z',
        amount: '99.00',
        currencyCode: 'PLN',
        description: 'September shop',
        destinationName: 'Lidl',
        budgetId: 'b1',
        budgetName: 'Groceries',
        syncedAt: '2026-09-28T12:00:00Z',
        updatedAt: '2026-09-28T12:00:00Z',
      },
    ])
    .run();
});

describe('useEnvelopeTransactions', () => {
  it('returns up to limitCount newest transactions in the period for the envelope', async () => {
    const { result } = await renderHook(() =>
      useEnvelopeTransactions('b1', 'Groceries', PERIOD, 3),
    );
    expect(result.current).toHaveLength(3);
    expect(result.current[0]!.groupId).toBe('g1');
    expect(result.current[0]!.description).toBe('Weekly shop');
    expect(result.current[0]!.payee).toBe('Biedronka');
    expect(result.current[1]!.groupId).toBe('g2');
    expect(result.current[2]!.groupId).toBe('g3');
  });

  it('returns empty array when envelope has no transactions', async () => {
    const { result } = await renderHook(() => useEnvelopeTransactions('b99', 'Other', PERIOD, 3));
    expect(result.current).toEqual([]);
  });
});
