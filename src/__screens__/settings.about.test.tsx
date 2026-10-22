// Settings → About and help (V4 board 31)
import React from 'react';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking, Share } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { setFf3ActiveHost, setFf3Version, setLastSyncedAt } from '../settings/appSettings';
import { loadSettings, SETTINGS_QUERY_KEY } from '../settings/loadSettings';
import { clearLog, logLine, readLog } from '../utils/log';
import { confirmDestructive } from '../ui/confirm';
import { router } from 'expo-router';
import AboutScreen from '../../app/settings/about';

let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useFocusEffect: jest.fn(),
}));

let mockVariant: string | undefined = undefined;

jest.mock('expo-constants', () => ({
  get expoConfig() {
    return {
      version: '2.3.4',
      android: { versionCode: 53 },
      extra: { appVariant: mockVariant },
    };
  },
}));

jest.mock('../ui/confirm', () => ({
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
  await queryClient.prefetchQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => loadSettings(mockDb),
  });
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={queryClient}>
        <AboutScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = createTestDb();
  clearLog();
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
});

describe('AboutScreen (board 31)', () => {
  it('renders app version, sync time, activity log, and firefly section', async () => {
    await setFf3ActiveHost(mockDb, 'https://ff3.example.com');
    await setFf3Version(mockDb, '6.4.2');
    await setLastSyncedAt(mockDb, new Date().toISOString());
    logLine('info', 'First test line');
    logLine('error', 'Second test line');

    await renderScreen();

    // Large title
    expect(screen.getAllByText('About and help').length).toBeGreaterThan(0);

    // This app section
    expect(screen.getByText('This app')).toBeTruthy();
    expect(screen.getByText('2.3.4 (53)')).toBeTruthy();
    expect(screen.getByText('Last synced')).toBeTruthy();
    expect(screen.getByText("What's new")).toBeTruthy();

    // When something goes wrong section
    expect(screen.getByText('When something goes wrong')).toBeTruthy();
    expect(screen.getByText('Activity log')).toBeTruthy();
    expect(screen.getByText(/2 lines/)).toBeTruthy();
    expect(screen.getByText('Share the log')).toBeTruthy();
    expect(screen.getByText('Clear the log')).toBeTruthy();
    expect(
      screen.getByText(
        'The log stays on this phone. Share it only with someone helping you fix a problem.',
      ),
    ).toBeTruthy();

    // Firefly III section
    expect(screen.getByText('Firefly III')).toBeTruthy();
    expect(screen.getByText('Open Firefly III in the browser')).toBeTruthy();
    expect(screen.getByText('Firefly III version')).toBeTruthy();
    expect(screen.getByText('6.4.2')).toBeTruthy();
  });

  it('navigates to whats new and logs', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByText("What's new"));
    expect(router.push).toHaveBeenCalledWith('/settings/whats-new');

    await fireEvent.press(screen.getByText('Activity log'));
    expect(router.push).toHaveBeenCalledWith('/settings/logs');
  });

  it('shares the log', async () => {
    logLine('warn', 'warning to share');
    await renderScreen();

    await fireEvent.press(screen.getByText('Share the log'));
    await waitFor(() => {
      expect(Share.share).toHaveBeenCalled();
    });
  });

  it('clears the log after confirmation', async () => {
    logLine('error', 'something failed');
    expect(readLog().length).toBeGreaterThan(0);

    await renderScreen();

    await fireEvent.press(screen.getByText('Clear the log'));
    await waitFor(() => {
      expect(confirmDestructive).toHaveBeenCalledWith('Clear the log?', 'Clear');
      expect(readLog().length).toBe(0);
    });
  });

  it('opens Firefly III in the browser', async () => {
    await setFf3ActiveHost(mockDb, 'https://my-firefly.test');
    await renderScreen();

    await fireEvent.press(screen.getByText('Open Firefly III in the browser'));
    await waitFor(() => {
      expect(Linking.openURL).toHaveBeenCalledWith('https://my-firefly.test');
    });
  });

  it('hides Feature flags in production builds', async () => {
    mockVariant = 'production';
    await renderScreen();
    expect(screen.queryByText('Feature flags')).toBeNull();
  });

  it('shows Feature flags in dev builds and navigates to flags screen', async () => {
    mockVariant = 'development';
    await renderScreen();
    const row = screen.getByText('Feature flags');
    expect(row).toBeTruthy();
    fireEvent.press(row);
    expect(router.push).toHaveBeenCalledWith('/settings/flags');
  });
});
