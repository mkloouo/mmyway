// Settings → Firefly III's demo rows: signed out, "Try the demo" loads the sample data and offers
// "Leave the demo"; leaving deletes it and offers the demo again. SQLite is real (better-sqlite3,
// src/db/testDb.ts); the live-query subscription, the sync-state hook and the confirm prompts are
// shimmed, since none of them has a JS implementation under Jest.
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { cachedTransactions, inboxItems, referenceAccounts } from '../db/schema';
import { confirmAction, confirmDestructive } from '../ui/confirm';
import SettingsScreen from '../../app/(tabs)/settings';

// `mock`-prefixed so Jest's hoisting lets the factories below close over it.
let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

// The real hook subscribes to expo-sqlite's change events, which Jest has no native module for.
jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

jest.mock('../sync/useSync', () => ({ useSync: () => ({ credentialsChanged: jest.fn() }) }));

// expo-router pulls in an untransformed ESM dependency under Jest; the navigation isn't under test.
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

// Signed out throughout: the demo only runs with no stored credentials.
jest.mock('../api/ff3/auth', () => ({
  readStoredCredentials: jest.fn(async () => null),
  signOut: jest.fn(),
  probeAbout: jest.fn(),
  signIn: jest.fn(),
}));

jest.mock('../ui/confirm', () => ({
  confirmAction: jest.fn(),
  confirmDestructive: jest.fn(),
}));

const TRY_BODY =
  'Fills the app with sample accounts, envelopes and transactions. Nothing is sent anywhere. Leave the demo from Settings.';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

// The first render of this screen is slow under Jest; the default 1s waits would give up on it.
configure({ asyncUtilTimeout: 10_000 });

/** Resolves once the settings have loaded: until then the demo rows have no press handler. */
async function renderScreen() {
  render(
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
        <SettingsScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(screen.getByText('not connected')).toBeTruthy());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = createTestDb();
  (confirmAction as jest.Mock).mockResolvedValue(true);
  (confirmDestructive as jest.Mock).mockResolvedValue(true);
});

describe('Settings → Firefly III demo rows', () => {
  it('signed out, "Try the demo" loads the sample data and shows "Leave the demo"', async () => {
    await renderScreen();

    fireEvent.press(await screen.findByText('Try the demo'));

    expect(confirmAction).toHaveBeenCalledWith('Try the demo?', 'Try the demo', TRY_BODY);
    expect(await screen.findByText('Leave the demo')).toBeTruthy();
    expect(screen.getByText('Demo loaded')).toBeTruthy();
    expect(screen.getByText('Demo')).toBeTruthy();
    expect(screen.queryByText('Try the demo')).toBeNull();
    expect(mockDb.select().from(referenceAccounts).all()).toHaveLength(9);
  });

  it('leaving the demo deletes what it loaded and offers the demo again', async () => {
    await renderScreen();
    fireEvent.press(await screen.findByText('Try the demo'));
    fireEvent.press(await screen.findByText('Leave the demo'));

    expect(confirmDestructive).toHaveBeenCalledWith(
      'Leave the demo?',
      'Leave the demo',
      'Everything you entered in the demo is deleted.',
    );
    expect(await screen.findByText('Try the demo')).toBeTruthy();
    expect(screen.queryByText('Leave the demo')).toBeNull();
    expect(mockDb.select().from(referenceAccounts).all()).toEqual([]);
    expect(mockDb.select().from(cachedTransactions).all()).toEqual([]);
  });

  it('does not load the demo over an Inbox item, and says why', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const T = '2026-01-01T00:00:00Z';
    mockDb
      .insert(inboxItems)
      .values({
        id: 'draft',
        kind: 'manual_entry',
        state: 'captured',
        draftJson: '{}',
        createdAt: T,
        updatedAt: T,
      })
      .run();
    await renderScreen();

    fireEvent.press(await screen.findByText('Try the demo'));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "Can't start the demo yet",
        "Clear or sync what's in the Inbox first — leaving the demo deletes everything in it.",
      ),
    );
    expect(screen.getByText('Try the demo')).toBeTruthy();
    expect(screen.queryByText('Leave the demo')).toBeNull();
    expect(mockDb.select().from(referenceAccounts).all()).toEqual([]);
    alert.mockRestore();
  });
});
