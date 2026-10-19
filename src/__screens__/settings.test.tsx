import { configure, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { payeeAliases, plannedObjects, referenceAccounts } from '../db/schema';
import { setFlagOverrides, setLastSyncedAt } from '../settings/appSettings';
import SettingsScreen from '../../app/(tabs)/settings';

let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('../api/ff3/auth', () => ({
  readStoredCredentials: jest.fn(async () => ({
    host: 'https://demo.firefly-iii.org',
    token: 'secret',
  })),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

configure({ asyncUtilTimeout: 10_000 });

async function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={queryClient}>
        <SettingsScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(screen.getByText('Your Firefly III')).toBeTruthy());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = createTestDb();
});

describe('SettingsScreen (board 26)', () => {
  it('renders hero card, sections, and counts', async () => {
    await setFlagOverrides(mockDb, {
      payee_nicknames: true,
      ff3_rules: true,
      app_lock: true,
      record_location: true,
    });
    await setLastSyncedAt(mockDb, new Date().toISOString());

    // Insert test data for counts:
    // 1 asset account, 2 liability accounts
    mockDb
      .insert(referenceAccounts)
      .values([
        {
          id: '1',
          name: 'Checking',
          type: 'asset',
          currencyCode: 'PLN',
          active: true,
          syncedAt: new Date().toISOString(),
        },
        {
          id: '2',
          name: 'Mortgage',
          type: 'liability',
          currencyCode: 'PLN',
          active: true,
          syncedAt: new Date().toISOString(),
        },
        {
          id: '3',
          name: 'Car Loan',
          type: 'liability',
          currencyCode: 'PLN',
          active: true,
          syncedAt: new Date().toISOString(),
        },
      ])
      .run();

    // 2 payee aliases
    mockDb
      .insert(payeeAliases)
      .values([
        {
          id: '1',
          alias: 'BIEDRONKA 1234',
          normalizedAlias: 'biedronka 1234',
          payeeName: 'Biedronka',
          createdAt: new Date().toISOString(),
        },
        {
          id: '2',
          alias: 'LIDL 99',
          normalizedAlias: 'lidl 99',
          payeeName: 'Lidl',
          createdAt: new Date().toISOString(),
        },
        {
          id: '3',
          alias: 'ZABKA 42',
          normalizedAlias: 'zabka 42',
          payeeName: 'Zabka',
          createdAt: new Date().toISOString(),
        },
      ])
      .run();

    // 4 rules, 5 subscriptions (bills + recurrences)
    mockDb
      .insert(plannedObjects)
      .values([
        {
          key: 'rule:r1',
          kind: 'rule',
          ff3Id: 'r1',
          name: 'R1',
          attributesJson: '{}',
          syncedAt: new Date().toISOString(),
        },
        {
          key: 'rule:r2',
          kind: 'rule',
          ff3Id: 'r2',
          name: 'R2',
          attributesJson: '{}',
          syncedAt: new Date().toISOString(),
        },
        {
          key: 'rule:r3',
          kind: 'rule',
          ff3Id: 'r3',
          name: 'R3',
          attributesJson: '{}',
          syncedAt: new Date().toISOString(),
        },
        {
          key: 'rule:r4',
          kind: 'rule',
          ff3Id: 'r4',
          name: 'R4',
          attributesJson: '{}',
          syncedAt: new Date().toISOString(),
        },
        {
          key: 'bill:b1',
          kind: 'bill',
          ff3Id: 'b1',
          name: 'B1',
          attributesJson: '{}',
          syncedAt: new Date().toISOString(),
        },
        {
          key: 'bill:b2',
          kind: 'bill',
          ff3Id: 'b2',
          name: 'B2',
          attributesJson: '{}',
          syncedAt: new Date().toISOString(),
        },
        {
          key: 'recurrence:rc1',
          kind: 'recurrence',
          ff3Id: 'rc1',
          name: 'RC1',
          attributesJson: '{}',
          syncedAt: new Date().toISOString(),
        },
        {
          key: 'recurrence:rc2',
          kind: 'recurrence',
          ff3Id: 'rc2',
          name: 'RC2',
          attributesJson: '{}',
          syncedAt: new Date().toISOString(),
        },
        {
          key: 'recurrence:rc3',
          kind: 'recurrence',
          ff3Id: 'rc3',
          name: 'RC3',
          attributesJson: '{}',
          syncedAt: new Date().toISOString(),
        },
      ])
      .run();

    await renderScreen();

    // Hero card
    expect(screen.getByText('Your Firefly III')).toBeTruthy();
    expect(screen.getByText(/Connected · synced/)).toBeTruthy();

    // Section headers
    expect(screen.getByText('When you add money')).toBeTruthy();
    expect(screen.getByText('Reading receipts')).toBeTruthy();
    expect(screen.getByText('Accounts and money')).toBeTruthy();
    expect(screen.getByText('Automation in Firefly III')).toBeTruthy();
    expect(screen.getByText('Privacy and reminders')).toBeTruthy();
    expect(screen.getByText('App')).toBeTruthy();

    // Accounts row and counts (1 account)
    expect(screen.getByText('Accounts')).toBeTruthy();
    expect(screen.getByText('1 · 0 envelopes')).toBeTruthy();

    // Loans and debts row and count (2 liabilities)
    expect(screen.getByText('Loans and debts')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();

    // Payee nicknames row and count (3 aliases)
    expect(screen.getByText('Payee nicknames')).toBeTruthy();
    expect(screen.getByText('"BIEDRONKA 1234" is Biedronka')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();

    // Rules row and count (4 rules)
    expect(screen.getByText('Rules')).toBeTruthy();
    expect(screen.getByText('Auto-fill category and budget')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();

    // Subscriptions and recurring row and count (5 subscriptions)
    expect(screen.getByText('Subscriptions and recurring')).toBeTruthy();
    expect(screen.getByText('Everything behind Planned, as stored')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();

    // Reading receipts Set up button
    expect(screen.getByText('Set up')).toBeTruthy();

    // Privacy & reminders
    expect(screen.getByText('Lock the app')).toBeTruthy();
    expect(screen.getByText('Reminders')).toBeTruthy();

    // App
    expect(screen.getByText('Language')).toBeTruthy();
    expect(screen.getByText('Like my phone')).toBeTruthy();
    expect(screen.getByText('About and help')).toBeTruthy();
  });
});
