import { render, screen, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { referenceBudgets, referenceCurrencies } from '../db/schema';
import NewEnvelopeScreen from '../../app/budget/new';

jest.setTimeout(15_000);

let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  router: { back: jest.fn() },
}));
jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

const SYNCED = '2026-10-11T08:00:00Z';

beforeAll(() => {
  mockDb = createTestDb();
  mockDb
    .insert(referenceCurrencies)
    .values({
      code: 'EUR',
      symbol: '€',
      decimalPlaces: 2,
      isDefault: true,
      enabled: true,
      syncedAt: SYNCED,
    })
    .run();
  mockDb
    .insert(referenceBudgets)
    .values([{ id: 'b1', name: 'Groceries', active: true, syncedAt: SYNCED }])
    .run();
});

async function renderScreen() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <NewEnvelopeScreen />
    </SafeAreaProvider>,
  );
}

describe('Budget → New Envelope screen', () => {
  it('renders the create envelope screen', async () => {
    await renderScreen();
    expect(screen.getByPlaceholderText('e.g. Groceries, Rent')).toBeTruthy();
    expect(screen.getByText('Create')).toBeTruthy();
    expect(screen.getByText('New envelope')).toBeTruthy();
    expect(screen.getByText('Envelope name')).toBeTruthy();
  });
});
