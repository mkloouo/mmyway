import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { referenceAccounts } from '../db/schema';
import { getReconcileShortfallAccountId } from '../settings/appSettings';
import CashSettingsScreen from '../../app/settings/cash';

let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function seed() {
  const db = createTestDb();
  db.insert(referenceAccounts)
    .values([
      {
        id: 'exp-1',
        name: 'Cash shortfall',
        type: 'expense',
        currencyCode: 'PLN',
        syncedAt: '2026-10-15T00:00:00Z',
      },
      {
        id: 'exp-2',
        name: 'Lost coins',
        type: 'expense',
        currencyCode: 'PLN',
        syncedAt: '2026-10-15T00:00:00Z',
      },
      {
        id: 'rev-1',
        name: 'Cash surplus',
        type: 'revenue',
        currencyCode: 'PLN',
        syncedAt: '2026-10-15T00:00:00Z',
      },
    ])
    .run();
  return db;
}

async function renderScreen() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false, gcTime: Infinity },
              mutations: { gcTime: Infinity },
            },
          })
        }
      >
        <CashSettingsScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

describe('Settings → Counting cash', () => {
  beforeEach(() => {
    mockDb = seed();
  });

  it('opens shortfall Choose sheet with Board 28 title and selects an account', async () => {
    await renderScreen();

    // Default shortfall payee is displayed
    expect(screen.getByText('Cash shortfall')).toBeTruthy();

    // Open shortfall picker
    await fireEvent.press(screen.getByText('Shortfall payee (expense account)'));

    // Board 28 title and subtitle are shown
    expect(screen.getByText('Missing cash goes to')).toBeTruthy();
    expect(screen.getByText('One of 2 expense accounts')).toBeTruthy();

    // Select the other expense account
    await fireEvent.press(screen.getByText('Lost coins'));

    // Verify it saved
    await waitFor(async () => {
      expect(await getReconcileShortfallAccountId(mockDb)).toBe('exp-2');
    });
  });
});
