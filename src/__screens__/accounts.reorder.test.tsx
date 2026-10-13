// Settings → Asset accounts → Reorder → Done with nothing dragged queues nothing, even when FF3's
// `order` numbers have gaps (they did, and every Done was sent as a reorder).
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { outboxOperations, referenceAccounts } from '../db/schema';
import { setAccountOrder } from '../settings/appSettings';
import AccountsScreen from '../../app/settings/accounts';
import { flagsQuery } from '../flags/useFlag';

let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

// The drag itself is DragList's own test; here only Reorder and Done are pressed.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { __esModule: true, default: { View }, FadeIn: { duration: () => undefined } };
});
jest.mock('react-native-gesture-handler', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ScrollView: require('react-native').ScrollView,
}));
jest.mock('../ui/DragList', () => ({
  DragList: ({ items, renderItem }: { items: unknown[]; renderItem: (i: unknown) => unknown }) =>
    items.map(renderItem),
}));

const SYNCED = '2026-10-11T08:00:00Z';
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

it('Done after Reorder with nothing dragged queues no reorder', async () => {
  mockDb = createTestDb();
  mockDb
    .insert(referenceAccounts)
    .values(
      ['Checking', 'Cash wallet', 'Savings'].map((name, i) => ({
        id: `a${i + 1}`,
        name,
        type: 'asset',
        currencyCode: 'PLN',
        active: true,
        syncedAt: SYNCED,
      })),
    )
    .run();
  // FF3's numbers, with gaps: already in this order, but not 1, 2, 3.
  await setAccountOrder(mockDb as never, { a1: 2, a2: 5, a3: 9 });

  const client = new QueryClient();
  await client.prefetchQuery(flagsQuery(mockDb as never));
  await render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={metrics}>
        <AccountsScreen />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
  await fireEvent.press(screen.getByLabelText('Reorder accounts'));
  await fireEvent.press(await screen.findByText('Done'));

  expect(mockDb.select().from(outboxOperations).all()).toHaveLength(0);
});
