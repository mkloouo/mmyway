// The cash count, rendered from a seeded test DB: the difference a typed total produces is read off
// the screen (the sweep's own arithmetic is tested in src/reconcile/sweep.test.ts), and the empty
// state appears only when no account carries the cash-envelope marker.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { referenceAccounts, referenceCurrencies } from '../db/schema';
import { formatMoney } from '../ui/money';
import CountScreen from '../../app/count';

jest.setTimeout(15_000);

// `mock`-prefixed so Jest's hoisting lets the factories below close over it.
let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

// The real hook subscribes to expo-sqlite's change events, which Jest has no native module for.
// better-sqlite3 answers synchronously, so `.all()` gives the rows during the render itself.
jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

jest.mock('../sync/useSync', () => ({
  useSync: () => ({ status: 'idle', syncNow: jest.fn() }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

const SYNCED = '2026-10-11T08:00:00Z';
const PLN = { code: 'PLN', symbol: 'zł', decimalPlaces: 2 };

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function seed(accounts: { id: string; name: string; notes?: string; balance: string }[]) {
  const db = createTestDb();
  db.insert(referenceCurrencies)
    .values({
      code: 'PLN',
      symbol: 'zł',
      decimalPlaces: 2,
      isDefault: true,
      enabled: true,
      syncedAt: SYNCED,
    })
    .run();
  db.insert(referenceAccounts)
    .values(
      accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: 'asset' as const,
        currencyCode: 'PLN',
        active: true,
        currentBalance: a.balance,
        notes: a.notes ?? null,
        includeNetWorth: true,
        syncedAt: SYNCED,
      })),
    )
    .run();
  return db;
}

async function renderCount() {
  return await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <CountScreen />
    </SafeAreaProvider>,
  );
}

describe('count cash', () => {
  it('shows the difference between the expected balance and a typed count', async () => {
    mockDb = seed([
      { id: 'w1', name: 'Cash wallet', notes: 'mmyway-envelope', balance: '485.00' },
      { id: 'j1', name: 'Jar at home', notes: 'mmyway-envelope', balance: '120.00' },
      { id: 'c1', name: 'Checking', balance: '1000.00' },
    ]);
    await renderCount();

    // Only the two marked accounts are envelopes; Checking is not counted.
    expect(screen.queryByText('Checking')).toBeNull();
    const fields = screen.getAllByPlaceholderText('—');
    expect(fields).toHaveLength(2);
    const [wallet] = fields;
    if (!wallet) throw new Error('no count field for Cash wallet');

    // 485,00 expected, 468,00 counted: 17,00 short, booked as a withdrawal.
    await fireEvent.changeText(wallet, '468.00');
    expect(screen.getByText(formatMoney('-17.00', PLN))).toBeTruthy();
  });

  it('shows the empty state with a switch per account when no envelope is marked', async () => {
    mockDb = seed([
      { id: 'c1', name: 'Checking', balance: '1000.00' },
      { id: 's1', name: 'Savings', balance: '5000.00' },
    ]);
    await renderCount();

    expect(screen.getByText('No accounts are marked as cash envelopes')).toBeTruthy();
    expect(screen.getByText('Checking')).toBeTruthy();
    expect(screen.getByText('Savings')).toBeTruthy();
    expect(screen.getByLabelText('Checking')).toBeTruthy();
    expect(screen.getByLabelText('Savings')).toBeTruthy();
    expect(screen.queryAllByPlaceholderText('—')).toHaveLength(0);
  });
});
