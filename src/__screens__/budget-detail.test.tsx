import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { createTestDb } from '../db/testDb';
import { bucketRow } from '../bucket/objects';
import { periodOf } from '../bucket/period';
import { bucketObjects, referenceBudgets, referenceCurrencies } from '../db/schema';
import { formatMoney } from '../ui/money';
import { localDay } from '../utils/day';
import EnvelopeScreen from '../../app/budget/[id]';

jest.setTimeout(15_000);

let mockDb: ReturnType<typeof createTestDb>;
// Read at each render, so one test can open the overspent envelope and the rest the first one.
let mockEnvelopeId = 'b1';

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockEnvelopeId }),
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
    .values([
      { id: 'b1', name: 'Groceries', active: true, syncedAt: SYNCED },
      { id: 'b2', name: 'Dining', active: true, syncedAt: SYNCED },
    ])
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
      bucketRow(
        'budget_limit',
        'b2',
        PERIOD,
        { id: '12', amount: '100.00', spent: '-150.00', currency_code: 'EUR', start: PERIOD },
        SYNCED,
      ),
    ])
    .run();
});

beforeEach(() => {
  mockEnvelopeId = 'b1';
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
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

  it('edits the name in place: a Save bar appears on change, and Undo drops it', async () => {
    await renderScreen();
    expect(screen.queryByText('Save')).toBeNull();

    fireEvent.changeText(screen.getByTestId('envelope-name'), 'Food');
    expect(await screen.findByDisplayValue('Food')).toBeTruthy();
    expect(await screen.findByText('Save')).toBeTruthy();

    fireEvent.press(screen.getByText('Undo'));
    await waitFor(() => expect(screen.queryByText('Save')).toBeNull());
    expect(await screen.findByDisplayValue('Groceries')).toBeTruthy();
  });

  it('keeps delete out of the page: it is in the ••• menu', async () => {
    await renderScreen();
    expect(screen.queryByText('Delete')).toBeNull();

    fireEvent.press(screen.getByLabelText(i18n.t('budget.moreLabel')));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Groceries',
      undefined,
      expect.arrayContaining([expect.objectContaining({ text: 'Delete', style: 'destructive' })]),
    );
  });

  it('has assign and move buttons', async () => {
    await renderScreen();
    expect(screen.getByText('Set the amount')).toBeTruthy();
    expect(screen.getByText('Move money here')).toBeTruthy();
  });

  it('warns about an overspent envelope, and not one that is within budget', async () => {
    mockEnvelopeId = 'b2';
    await renderScreen();
    // Dining holds 100 and has spent 150: 50 over.
    expect(
      screen.getByText(i18n.t('budget.overspentBy', { amount: formatMoney('50.00', EUR) })),
    ).toBeTruthy();
  });

  it('shows no overspend warning for an envelope within budget', async () => {
    await renderScreen();
    expect(
      screen.queryByText(i18n.t('budget.overspentBy', { amount: formatMoney('479.50', EUR) })),
    ).toBeNull();
    expect(screen.queryByText(/over budget/)).toBeNull();
  });
});
