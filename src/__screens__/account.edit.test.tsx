// Settings → account page (app/accounts/[id].tsx): the save bar is there only once something changed,
// and a switch row flips when pressed. SQLite is real (better-sqlite3, src/db/testDb.ts); the live
// query and expo-router are shimmed.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { eq } from 'drizzle-orm';
import { setEnvelopeMarker } from '../accounts/envelopeMarker';
import { referenceAccounts, referenceCurrencies } from '../db/schema';
import AccountScreen from '../../app/accounts/[id]';

let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() },
  useLocalSearchParams: () => ({ id: 'a1' }),
}));
jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

const SYNCED = '2026-10-11T08:00:00Z';
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

beforeEach(() => {
  jest.clearAllMocks();
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
  mockDb
    .insert(referenceAccounts)
    .values({
      id: 'a1',
      name: 'Cash wallet',
      type: 'asset',
      currencyCode: 'PLN',
      active: true,
      accountRole: 'cashWalletAsset',
      syncedAt: SYNCED,
    })
    .run();
});

async function renderScreen() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <AccountScreen />
    </SafeAreaProvider>,
  );
}

function saveButton() {
  return screen.queryByRole('button', { name: 'Save' });
}

describe('Account page', () => {
  it('shows the save bar only once the account has changed, and Undo takes it away', async () => {
    await renderScreen();
    expect(saveButton()).toBeNull();

    await fireEvent.changeText(screen.getByDisplayValue('Cash wallet'), 'Cash wallet · home');
    expect(saveButton()).not.toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(saveButton()).toBeNull();
  });

  it('Transactions opens the Activity tab filtered to this account', async () => {
    await renderScreen();
    // Matches the English text, or the key itself until the new locale key is merged.
    await fireEvent.press(
      screen.getByRole('button', { name: /^(Transactions|account\.transactions)$/ }),
    );

    expect(router.navigate).toHaveBeenCalledWith({
      pathname: '/activity',
      params: { account: 'a1', at: expect.any(String) },
    });
  });

  it('flips a switch row when it is pressed', async () => {
    await renderScreen();
    // The first switch is "In pickers and lists" (active): on for this account.
    const [inPickers] = screen.getAllByRole('switch');
    expect(inPickers!.props.accessibilityState.checked).toBe(true);

    await fireEvent.press(inPickers!);

    expect(screen.getAllByRole('switch')[0]!.props.accessibilityState.checked).toBe(false);
    expect(saveButton()).not.toBeNull();
  });

  it('shows "cash envelope" in the subtitle for an envelope account, not "In the cash count"', async () => {
    mockDb
      .update(referenceAccounts)
      .set({ notes: setEnvelopeMarker('Home wallet', true), currentBalance: '485.00' })
      .where(eq(referenceAccounts.id, 'a1'))
      .run();

    await renderScreen();
    expect(screen.getByText('485.00 zł now · cash envelope')).toBeTruthy();
    expect(screen.queryByText(/485\.00 zł now · In the cash count/)).toBeNull();
  });

  it('Count cash is always shown and navigates to /count', async () => {
    await renderScreen();
    const countBtn = screen.getByRole('button', { name: /^(Count cash|count\.title)$/ });
    expect(countBtn).toBeTruthy();
    await fireEvent.press(countBtn);
    expect(router.push).toHaveBeenCalledWith('/count');
  });

  it('has MoreButton in header', async () => {
    await renderScreen();
    expect(screen.getByRole('button', { name: /^(More|account\.moreAria)$/ })).toBeTruthy();
  });
});
