// The Budget tab, rendered from a seeded bucket_objects: the numbers a wrong sum would get wrong
// (Ready to Assign, an envelope's remainder) are read off the screen, not off the pure functions.
// SQLite is real (better-sqlite3, src/db/testDb.ts); only the live-query subscription and the
// pull-to-refresh are shimmed, since neither has a JS implementation outside the app.
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { bucketRow } from '../bucket/objects';
import { periodOf } from '../bucket/period';
import {
  bucketObjects,
  referenceAccounts,
  referenceBudgets,
  referenceCurrencies,
} from '../db/schema';
import { formatMoney } from '../money/format';
import { localDay } from '../utils/day';
import BudgetScreen from '../../app/(tabs)/budget';
import { flagsQuery } from '../flags/useFlag';
import { setFlagOverrides } from '../settings/appSettings';

jest.setTimeout(15_000);

// `mock`-prefixed so Jest's hoisting lets the factories below close over it.
let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

// The real hook subscribes to expo-sqlite's change events, which Jest has no native module for.
// better-sqlite3 is the synchronous driver, so `.all()` answers during the render itself — no
// state update after the fact, and so nothing to wrap in act().
jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

jest.mock('../sync/useSync', () => ({
  usePullToRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }),
}));

// expo-router pulls in an untransformed ESM dependency under Jest; the navigation isn't what is
// under test here.
jest.mock('../ui/navigateOnce', () => ({ navigateOnce: jest.fn() }));

// The route guard sends a flag-off visit to "/" through expo-router's Redirect; a stand-in records it.
const mockRedirect = jest.fn<null, [{ href: string }]>(() => null);
jest.mock('expo-router', () => ({ Redirect: (props: { href: string }) => mockRedirect(props) }));

// The screen reads the period off the phone's own clock, so the seed is keyed to the same day
// rather than to a pinned date — a fixture that only lined up in October 2026 would rot.
const PERIOD = periodOf(localDay()).start;
const SYNCED = '2026-10-11T08:00:00Z';
const PLN = { symbol: 'zł', decimalPlaces: 2 };
const zl = (amount: string) => formatMoney(amount, PLN);

beforeAll(() => {
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
    .values([
      {
        id: 'a1',
        name: 'Revolut',
        type: 'asset',
        currencyCode: 'PLN',
        active: true,
        currentBalance: '2000.00',
        includeNetWorth: true,
        syncedAt: SYNCED,
      },
      // Inactive: closed accounts hold no liquid cash, so this 500 must not reach the count.
      {
        id: 'a2',
        name: 'Old card',
        type: 'asset',
        currencyCode: 'PLN',
        active: false,
        currentBalance: '500.00',
        includeNetWorth: true,
        syncedAt: SYNCED,
      },
    ])
    .run();
  mockDb
    .insert(referenceBudgets)
    .values([
      { id: 'b1', name: 'Groceries', active: true, syncedAt: SYNCED },
      { id: 'b2', name: 'Dining Out', active: true, syncedAt: SYNCED },
    ])
    .run();
  mockDb
    .insert(bucketObjects)
    .values([
      bucketRow(
        'budget_limit',
        'b1',
        PERIOD,
        { id: '11', amount: '800.00', spent: '-320.50', currency_code: 'PLN', start: PERIOD },
        SYNCED,
      ),
      bucketRow(
        'budget_limit',
        'b2',
        PERIOD,
        { id: '12', amount: '200.00', spent: '-245.00', currency_code: 'PLN', start: PERIOD },
        SYNCED,
      ),
      bucketRow(
        'piggy',
        'p1',
        null,
        {
          name: 'New laptop',
          current_amount: '300.00',
          target_amount: '4000.00',
          currency_code: 'PLN',
          accounts: [{ id: 'a1', name: 'Revolut', current_amount: '300.00' }],
        },
        SYNCED,
      ),
    ])
    .run();
});

async function renderScreen(budgetOn = true) {
  // The route reads its flags from the query cache, so load them from the test db before the first render.
  await setFlagOverrides(mockDb as never, { budget: budgetOn });
  const client = new QueryClient();
  await client.prefetchQuery(flagsQuery(mockDb as never));
  return render(
    <QueryClientProvider client={client}>
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <BudgetScreen />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

describe('Budget tab with the budget flag off', () => {
  it('redirects to the Inbox instead of showing the budget', async () => {
    await renderScreen(false);
    expect(mockRedirect).toHaveBeenCalledWith({ href: '/' });
    expect(screen.queryByText('Ready to assign')).toBeNull();
  });
});

describe('Budget tab', () => {
  it('shows Ready to Assign as cash minus what is already allocated', async () => {
    await renderScreen();
    // 2000 cash − (479.50 left in Groceries + 0 for the overspent Dining Out + 300 saved) = 1220.50.
    // The inactive account's 500 is not cash, and Dining Out's −45 is not subtracted twice.
    expect(screen.getByText(zl('1220.50'))).toBeTruthy();
    expect(screen.getByText('Ready to assign')).toBeTruthy();
  });

  it('shows an envelope its remainder, and an overspent one as negative', async () => {
    await renderScreen();
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(screen.getByText(zl('479.50'))).toBeTruthy();
    expect(screen.getByText('Dining Out')).toBeTruthy();
    expect(screen.getByText(zl('-45.00'))).toBeTruthy();
  });

  it('lists a sinking fund with what is saved against its target', async () => {
    await renderScreen();
    expect(screen.getByText('New laptop')).toBeTruthy();
    expect(screen.getByText(new RegExp(`of ${escapeRegExp(zl('4000.00'))}`))).toBeTruthy();
  });

  it('offers to cover an overspent envelope from another one', async () => {
    await renderScreen();
    // Dining Out is 45 over: the row is the way into the move sheet, pre-filled with the shortfall.
    const cover = screen.getByText(`Cover ${zl('45.00')} from another envelope`);
    expect(cover).toBeTruthy();
    // Groceries is not overspent, so it gets no such row.
    expect(screen.queryByText(`Cover ${zl('479.50')} from another envelope`)).toBeNull();
  });

  it('says on the screen why its number differs from the one in Firefly III', async () => {
    await renderScreen();
    expect(screen.getByText(/left to budget/)).toBeTruthy();
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
