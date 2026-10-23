// The cash count, rendered from a seeded test DB: the difference a typed total produces is read off
// the screen (the sweep's own arithmetic is tested in src/reconcile/sweep.test.ts), and the empty
// state appears only when no account carries the cash-envelope marker.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { outboxOperations, referenceAccounts, referenceCurrencies } from '../db/schema';
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

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function seed(
  accounts: {
    id: string;
    name: string;
    notes?: string;
    balance: string;
    balanceDate?: string;
  }[],
) {
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
        currentBalanceDate: a.balanceDate ?? new Date().toISOString(),
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
    const wallet = screen.getByPlaceholderText('—');

    // 485,00 expected, 468,00 counted: 17,00 short, booked as a withdrawal.
    await fireEvent.changeText(wallet, '468.00');
    expect(screen.getByText(/17.*short/)).toBeTruthy();
  });

  it('navigates to settings from header gear button', async () => {
    mockDb = seed([{ id: 'w1', name: 'Cash wallet', notes: 'mmyway-envelope', balance: '485.00' }]);
    await renderCount();

    const gearBtn = screen.getByLabelText('Cash count settings');
    await fireEvent.press(gearBtn);
    expect(router.push).toHaveBeenCalledWith('/settings/cash');
  });

  it('switches the active envelope when Count pill is pressed', async () => {
    mockDb = seed([
      { id: 'w1', name: 'Cash wallet', notes: 'mmyway-envelope', balance: '485.00' },
      { id: 'j1', name: 'Jar at home', notes: 'mmyway-envelope', balance: '120.00' },
    ]);
    await renderCount();

    const countJar = screen.getByRole('button', { name: 'Count' });
    await fireEvent.press(countJar);

    // Now Jar at home is active
    expect(screen.getByText(/expected 120[.,]00 zł/)).toBeTruthy();
  });

  it('shows the empty state with a switch per account and Start counting button when no envelope is marked', async () => {
    mockDb = seed([
      { id: 'c1', name: 'Checking', balance: '1000.00' },
      { id: 's1', name: 'Savings', balance: '5000.00' },
    ]);
    await renderCount();

    expect(screen.getByText('No cash envelopes yet')).toBeTruthy();
    expect(screen.getByText('Nothing to count yet')).toBeTruthy();
    expect(screen.getByText('Checking')).toBeTruthy();
    expect(screen.getByText('Savings')).toBeTruthy();
    expect(screen.getByLabelText('Checking')).toBeTruthy();
    expect(screen.getByLabelText('Savings')).toBeTruthy();
    expect(screen.queryAllByPlaceholderText('—')).toHaveLength(0);

    const startBtn = screen.getByRole('button', { name: 'Start counting' });
    expect(startBtn.props.accessibilityState?.disabled).toBe(true);

    const checkingSwitch = screen.getByLabelText('Checking');
    await fireEvent(checkingSwitch, 'valueChange', true);

    expect(startBtn.props.accessibilityState?.disabled).toBeFalsy();
    await fireEvent.press(startBtn);

    // Now Checking is an envelope
    expect(await screen.findByPlaceholderText('—')).toBeTruthy();
  });

  it('shows the stale state when balances are older than 24 hours', async () => {
    mockDb = seed([
      {
        id: 'w1',
        name: 'Cash wallet',
        notes: 'mmyway-envelope',
        balance: '485.00',
        balanceDate: '2026-10-01T00:00:00Z',
      },
      {
        id: 'j1',
        name: 'Jar at home',
        notes: 'mmyway-envelope',
        balance: '120.00',
        balanceDate: '2026-10-01T00:00:00Z',
      },
    ]);
    await renderCount();

    expect(screen.getByText(/Balances are .* old/)).toBeTruthy();
    expect(
      screen.getByText('Counting against old numbers would book the wrong difference. Sync first.'),
    ).toBeTruthy();
    expect(screen.getByText('Waiting for a fresh sync')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync before counting' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Sync before counting' }).props.accessibilityState
        ?.disabled,
    ).toBe(true);

    // No editable inputs shown
    expect(screen.queryAllByPlaceholderText('—')).toHaveLength(0);
  });

  it('shows out of date notice when changes are queued in outbox', async () => {
    mockDb = seed([
      {
        id: 'w1',
        name: 'Cash wallet',
        notes: 'mmyway-envelope',
        balance: '485.00',
      },
    ]);
    mockDb
      .insert(outboxOperations)
      .values({
        id: 'op1',
        sequence: 1,
        kind: 'create_transaction',
        payloadJson: '{}',
        status: 'pending',
        createdAt: SYNCED,
      })
      .run();

    await renderCount();

    expect(screen.getByText('Balances are out of date')).toBeTruthy();
    expect(screen.getByText(/1 change hasn't reached Firefly III yet/)).toBeTruthy();
    expect(screen.getByText('Waiting for a fresh sync')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync before counting' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Sync before counting' }).props.accessibilityState
        ?.disabled,
    ).toBe(true);
  });
});
