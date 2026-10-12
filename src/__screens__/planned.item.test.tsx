// The planned item page: an existing item renders, Save appears only once something changed, the
// reminder timing is stored per payment, and a notification's "Skip this one" asks once on open.
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { createTestDb } from '../db/testDb';
import { referenceCurrencies } from '../db/schema';
import { getReminderOverrides } from '../settings/appSettings';
import type { PlannedItem } from '../planned/items';
import type { PlannedFields } from '../planned/model';
import PlannedItemScreen from '../../app/planned/[key]';

jest.setTimeout(15_000);

let mockDb: ReturnType<typeof createTestDb>;
let mockParams: { key: string; skip?: string } = { key: 'k1' };

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('../planned/usePlanned', () => ({
  usePlanned: () => ({ items: [mockItem], loaded: true }),
}));

jest.mock('../planned/notifications', () => ({
  syncPlannedNotifications: jest.fn(async () => undefined),
}));

const SYNCED = '2026-10-11T08:00:00Z';

const fields: PlannedFields = {
  name: 'Rent',
  type: 'withdrawal',
  sourceId: null,
  sourceName: 'Checking',
  destinationId: null,
  destinationName: 'Landlord',
  amount: '2400.00',
  currencyCode: 'PLN',
  notes: null,
  repeats: true,
  repetitions: [{ type: 'monthly', moment: '15', skip: 0, weekend: 1 }],
  end: { kind: 'forever' },
  date: '2026-10-15',
  time: null,
  skipDays: [],
  categoryName: 'Housing',
  tags: [],
};

const mockItem: PlannedItem = { key: 'k1', fields, group: null, queued: false };

beforeEach(() => {
  mockParams = { key: 'k1' };
  mockDb = createTestDb();
  mockDb
    .insert(referenceCurrencies)
    .values({
      code: 'PLN',
      symbol: 'zł',
      decimalPlaces: 2,
      isDefault: true,
      enabled: true,
      syncedAt: SYNCED,
    })
    .run();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function renderScreen() {
  return await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={new QueryClient()}>
        <PlannedItemScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

describe('Planned item screen', () => {
  it('renders an existing item by its name', async () => {
    await renderScreen();
    expect(screen.getByText('Rent')).toBeTruthy();
    expect(screen.getByText('Checking')).toBeTruthy();
  });

  it('shows Save only once a field differs from the item, and Undo drops it again', async () => {
    await renderScreen();
    expect(screen.queryByText(i18n.t('common.save'))).toBeNull();

    await fireEvent.changeText(screen.getByDisplayValue('Rent'), 'Rent 2');
    expect(screen.getByText(i18n.t('common.save'))).toBeTruthy();

    await fireEvent.press(screen.getByText(i18n.t('common.undo')));
    expect(screen.queryByText(i18n.t('common.save'))).toBeNull();
  });

  it('stores "Off" for a payment\'s reminder', async () => {
    await renderScreen();
    const defaultWhen = i18n.t('planned.remind.default', {
      when: i18n.t('planned.remind.fewDays'),
    });
    // The reminder row shows the global timing until its load lands.
    await waitFor(() => expect(screen.getByText(defaultWhen)).toBeTruthy());

    await fireEvent.press(screen.getByText(i18n.t('planned.remind.title')));
    await fireEvent.press(screen.getByText(i18n.t('planned.remind.off')));

    await waitFor(async () => expect(await getReminderOverrides(mockDb)).toEqual({ k1: 'off' }));
  });

  it('asks once to skip the date a notification names', async () => {
    mockParams = { key: 'k1', skip: '2026-10-15' };
    await renderScreen();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });
});
