// Settings → Liabilities: lists only the liabilities, and + opens the new-account form on Liability.
// SQLite is real (better-sqlite3, src/db/testDb.ts); the live query and expo-router are shimmed.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { referenceAccounts } from '../db/schema';
import LiabilitiesScreen from '../../app/settings/liabilities';

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

const SYNCED = '2026-10-11T08:00:00Z';
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function account(id: string, name: string, type: string, active = true) {
  return { id, name, type, currencyCode: 'EUR', active, syncedAt: SYNCED };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = createTestDb();
});

async function renderScreen() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <LiabilitiesScreen />
    </SafeAreaProvider>,
  );
}

describe('Settings → Liabilities', () => {
  it('lists the liabilities, inactive ones marked, and no asset accounts', async () => {
    mockDb
      .insert(referenceAccounts)
      .values([
        account('a1', 'Checking', 'asset'),
        account('l1', 'Home loan', 'liability'),
        account('l2', 'Old card debt', 'liability', false),
      ])
      .run();

    await renderScreen();

    expect(screen.getByText('Home loan')).toBeTruthy();
    expect(screen.getByText('Old card debt')).toBeTruthy();
    expect(screen.getByText('Inactive')).toBeTruthy();
    expect(screen.queryByText('Checking')).toBeNull();
  });

  it("shows a liability's current balance on its row", async () => {
    mockDb
      .insert(referenceAccounts)
      .values({ ...account('l1', 'Home loan', 'liability'), currentBalance: '-5000.00' })
      .run();

    await renderScreen();

    // Digit grouping follows the device locale; the amount is there either way.
    expect(screen.getByText(/−?5\D?000/)).toBeTruthy();
  });

  it('says so when no liability has been synced', async () => {
    mockDb
      .insert(referenceAccounts)
      .values([account('a1', 'Checking', 'asset')])
      .run();

    await renderScreen();

    expect(screen.getByText('No liabilities synced yet')).toBeTruthy();
  });

  it('+ opens the new-account form with type=liability', async () => {
    await renderScreen();

    fireEvent.press(screen.getByLabelText('New liability'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/accounts/new',
      params: { type: 'liability' },
    });
  });
});
