// Settings → Your Firefly III (V4 board 29)
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { setFf3ActiveHost, setFlagOverrides, setLastSyncedAt } from '../settings/appSettings';
import { readStoredCredentials, probeAbout, signOut } from '../api/ff3/auth';
import { readHosts } from '../api/ff3/hosts';
import { loadProxyHeaders } from '../api/ff3/proxyHeaders';
import ConnectionScreen from '../../app/settings/connection';

let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

const mockSyncNow = jest.fn();
jest.mock('../sync/useSync', () => ({
  useSync: () => ({
    credentialsChanged: jest.fn(),
    status: 'idle',
    syncNow: mockSyncNow,
  }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('../api/ff3/auth', () => ({
  readStoredCredentials: jest.fn(),
  signOut: jest.fn(),
  probeAbout: jest.fn(),
  signIn: jest.fn(),
}));

jest.mock('../api/ff3/hosts', () => ({
  readHosts: jest.fn(),
  writeHosts: jest.fn(),
}));

jest.mock('../api/ff3/proxyHeaders', () => ({
  loadProxyHeaders: jest.fn(),
}));

jest.mock('../ui/confirm', () => ({
  confirmAction: jest.fn(async () => true),
  confirmDestructive: jest.fn(async () => true),
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
        <ConnectionScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(screen.getAllByText('Your Firefly III').length).toBeGreaterThan(0));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = createTestDb();
  (readStoredCredentials as jest.Mock).mockResolvedValue(null);
  (readHosts as jest.Mock).mockResolvedValue([]);
  (loadProxyHeaders as jest.Mock).mockResolvedValue({});
  (probeAbout as jest.Mock).mockResolvedValue({ ok: true, version: '6.1.0' });
});

describe('ConnectionScreen (board 29)', () => {
  it('renders signed out view with empty state', async () => {
    await renderScreen();

    // Large title
    expect(screen.getAllByText('Your Firefly III').length).toBeGreaterThan(0);

    // Status card
    expect(screen.getByText('not connected')).toBeTruthy();
    expect(screen.getByText('Not signed in')).toBeTruthy();
    expect(screen.getByText('Sync now')).toBeTruthy();
    expect(screen.getByText('Open in browser')).toBeTruthy();

    // Addresses section
    expect(screen.getByText('Addresses')).toBeTruthy();
    expect(screen.getByText('Test all')).toBeTruthy();
    expect(screen.getByText('+ Add an address')).toBeTruthy();

    // Access section
    expect(screen.getByText('Access')).toBeTruthy();
    expect(screen.getByText('Access token')).toBeTruthy();
    expect(screen.getByText('none')).toBeTruthy();

    // Account section
    expect(screen.getByText('Account')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
    expect(
      screen.getByText('You can sign out once everything waiting has been sent.'),
    ).toBeTruthy();
  });

  it('renders signed in view with addresses, masked token and proxy headers', async () => {
    (readStoredCredentials as jest.Mock).mockResolvedValue({
      host: 'http://localhost:8080',
      apiToken: 'eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.9c1e',
    });
    (readHosts as jest.Mock).mockResolvedValue(['http://localhost:8080', 'https://ff.example.net']);
    (loadProxyHeaders as jest.Mock).mockResolvedValue({
      'CF-Access-Client-Id': 'id',
      'CF-Access-Client-Secret': 'secret',
    });
    await setFf3ActiveHost(mockDb, 'http://localhost:8080');
    await setLastSyncedAt(mockDb, new Date().toISOString());
    await setFlagOverrides(mockDb, { reverse_proxy: true });

    await renderScreen();

    // Status card
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText(/Synced/)).toBeTruthy();

    // Masked token
    expect(screen.getByText('•••• 9c1e')).toBeTruthy();

    // Reverse proxy with subtitle
    expect(screen.getByText('Reverse proxy')).toBeTruthy();
    expect(screen.getByText('Extra headers for Cloudflare Access and similar')).toBeTruthy();
    expect(screen.getByText('2 headers')).toBeTruthy();

    // Inline addresses
    expect(screen.getByText('http://localhost:8080')).toBeTruthy();
    expect(screen.getByText('in use')).toBeTruthy();
    expect(screen.getByText('https://ff.example.net')).toBeTruthy();

    // Test all button
    const testAllBtn = screen.getByText('Test all');
    fireEvent.press(testAllBtn);
    await waitFor(() => {
      expect(probeAbout).toHaveBeenCalledWith(
        'http://localhost:8080',
        'eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.9c1e',
      );
      expect(probeAbout).toHaveBeenCalledWith(
        'https://ff.example.net',
        'eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.9c1e',
      );
    });
  });

  it('tapping sign out triggers signOut when signed in', async () => {
    (readStoredCredentials as jest.Mock).mockResolvedValue({
      host: 'http://localhost:8080',
      apiToken: 'secret9c1e',
    });
    (readHosts as jest.Mock).mockResolvedValue(['http://localhost:8080']);

    await renderScreen();

    const signOutBtn = screen.getByText('Sign out');
    fireEvent.press(signOutBtn);

    await waitFor(() => {
      expect(signOut).toHaveBeenCalled();
    });
  });
});
