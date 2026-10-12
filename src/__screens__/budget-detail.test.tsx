import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { bucketRow } from '../bucket/objects';
import { periodOf } from '../bucket/period';
import { bucketObjects, referenceBudgets, referenceCurrencies } from '../db/schema';
import { formatMoney } from '../ui/money';
import { localDay } from '../utils/day';
import EnvelopeScreen from '../../app/budget/[id]';

jest.setTimeout(15_000);

let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'b1' }),
  router: { back: jest.fn() },
}));

jest.mock('../ui/navigateOnce', () => ({ navigateOnce: jest.fn() }));

const PERIOD = periodOf(localDay()).start;
const SYNCED = '2026-10-11T08:00:00Z';
const EUR = { symbol: '€', decimalPlaces: 2 };

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
  mockDb
    .insert(bucketObjects)
    .values([
      bucketRow(
        'budget_limit',
        'b1',
        PERIOD,
        { id: '11', amount: '800.00', spent: '-320.50', currency_code: 'EUR', start: PERIOD },
        SYNCED,
      ),
    ])
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
      <EnvelopeScreen />
    </SafeAreaProvider>,
  );
}

describe('Budget detail screen', () => {
  it('displays envelope name and available amount', async () => {
    await renderScreen();
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(screen.getByText(formatMoney('479.50', EUR))).toBeTruthy();
  });

  it('shows rename and delete buttons', async () => {
    await renderScreen();
    expect(screen.getByText('Rename')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('has assign and move buttons', async () => {
    await renderScreen();
    expect(screen.getByText('Set the amount')).toBeTruthy();
    expect(screen.getByText('Move money here')).toBeTruthy();
  });
});
