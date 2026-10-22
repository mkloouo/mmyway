import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { FLAG_NAMES } from '../flags/registry';
import {
  getCachedFlags,
  getFlagOverrides,
  setCachedFlags,
  setFlagOverrides,
} from '../settings/appSettings';
import { router } from 'expo-router';
import FlagsScreen, { FLAGS_ADMIN_QUERY_KEY } from '../../app/settings/flags';

let mockDb: ReturnType<typeof createTestDb>;
let mockVariant: string | undefined = 'development';

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { createElement } = jest.requireActual('react');
    const { Text } = jest.requireActual('react-native');
    return createElement(Text, null, `redirected to ${href}`);
  },
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

jest.mock('expo-constants', () => ({
  get expoConfig() {
    return {
      version: '1.0.0',
      extra: { appVariant: mockVariant },
    };
  },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  });
  await queryClient.prefetchQuery({
    queryKey: FLAGS_ADMIN_QUERY_KEY,
    queryFn: async () => ({
      cached: await getCachedFlags(mockDb),
      overrides: await getFlagOverrides(mockDb),
    }),
  });
  return await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={queryClient}>
        <FlagsScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = createTestDb();
  mockVariant = 'development';
});

describe('FlagsScreen', () => {
  it('redirects to home in production builds', async () => {
    mockVariant = 'production';
    await renderScreen();
    expect(await screen.findByText('redirected to /')).toBeTruthy();
  });

  it('renders all flags with descriptions and default sources in dev builds', async () => {
    await renderScreen();

    expect(await screen.findByText('Feature flags')).toBeTruthy();
    for (const name of FLAG_NAMES) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getAllByText(/Source: Default/).length).toBe(FLAG_NAMES.length);
  });

  it('indicates Flagsmith source when flag is cached remotely', async () => {
    await setCachedFlags(mockDb, { budget: true });
    await renderScreen();

    expect(await screen.findByText('Feature flags')).toBeTruthy();
    expect(screen.getByText(/Source: Flagsmith/)).toBeTruthy();
  });

  it('toggles a flag override and saves to DB', async () => {
    await renderScreen();

    const budgetSwitch = await screen.findByLabelText('budget');
    expect(budgetSwitch.props.accessibilityState.checked).toBe(false);

    fireEvent.press(budgetSwitch);

    await screen.findByText(/Source: Override/);
    const overrides = await getFlagOverrides(mockDb);
    expect(overrides.budget).toBe(true);
  });

  it('clears all overrides when Clear overrides is pressed', async () => {
    await setFlagOverrides(mockDb, { budget: true, demo_mode: true });
    await renderScreen();

    expect((await screen.findAllByText(/Source: Override/)).length).toBe(2);
    const clearButtons = screen.getAllByText('Clear overrides');
    expect(clearButtons.length).toBeGreaterThan(0);

    fireEvent.press(clearButtons[0]!);

    const overrides = await getFlagOverrides(mockDb);
    expect(Object.keys(overrides).length).toBe(0);
  });

  it('navigates back when back button is pressed', async () => {
    await renderScreen();
    const backBtn = await screen.findByLabelText('About and help');
    fireEvent.press(backBtn);
    expect(router.back).toHaveBeenCalled();
  });
});
