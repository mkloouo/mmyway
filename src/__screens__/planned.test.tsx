// Planned tab → Coming up. SQLite is real (better-sqlite3, src/db/testDb.ts); the live-query
// subscription, the pull-to-refresh hook and expo-router are shimmed, as in rules.test.tsx.
import {
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { createTestDb } from '../db/testDb';
import { outboxOperations } from '../db/schema';
import { storePlanned } from '../planned/objects';
import { occurrenceLabel, relativeDayLabel } from '../planned/labels';
import { formatMoney } from '../money/format';
import { localDay, dayDate } from '../utils/day';
import PlannedScreen from '../../app/(tabs)/planned';

// `mock`-prefixed so Jest's hoisting lets the factories below close over it.
let mockDb: ReturnType<typeof createTestDb>;
const mockBooked = jest.fn();

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

// No Firefly III session in tests; the booked list is whatever a test sets on mockBooked.
jest.mock('../api/ff3/session', () => ({ getClient: async () => ({}) }));
jest.mock('../planned/objects', () => ({
  ...jest.requireActual('../planned/objects'),
  fetchRecurrenceTransactions: (...args: unknown[]) => mockBooked(...args),
}));

// The real hook subscribes to expo-sqlite's change events, which Jest has no native module for.
jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

jest.mock('../sync/useSync', () => ({
  usePullToRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }),
}));

// expo-router pulls in an untransformed ESM dependency under Jest; the navigation isn't under test.
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

configure({ asyncUtilTimeout: 10_000 });

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>
    </QueryClientProvider>
  );
}

const plusDays = (days: number): string => {
  const d = dayDate(localDay());
  d.setDate(d.getDate() + days);
  return localDay(d);
};

/** The first day from three days out whose day number is 1–28, so next month's is the same number. */
function nearDay(): string {
  let days = 3;
  while (Number(plusDays(days).slice(8, 10)) > 28) days++;
  return plusDays(days);
}

/** The same day number one month on. */
function monthAfter(day: string): string {
  const d = dayDate(day);
  d.setMonth(d.getMonth() + 1);
  return localDay(d);
}

/** A booking on `day` as FF3 returns a recurrence's transactions. */
const bookingOn = (day: string) => ({
  id: '50',
  attributes: {
    transactions: [{ date: `${day}T00:00:00+00:00`, amount: '2400.00', currency_code: 'PLN' }],
  },
});

/**
 * One planned transaction, "Rent": a subscription, a rule and a monthly recurring transaction, all
 * named alike, so it is complete and listed. Its next occurrence is on `day`.
 */
async function seedRent(day: string) {
  const dayOfMonth = String(Number(day.slice(8, 10)));
  await storePlanned(mockDb, 'bill', '1', {
    name: 'Rent',
    amount_min: '2400.00',
    amount_max: '2400.00',
    currency_code: 'PLN',
    date: day,
    repeat_freq: 'monthly',
    skip: 0,
  });
  await storePlanned(mockDb, 'rule', '2', {
    title: 'Rent',
    triggers: [{ type: 'description_contains', value: 'Landlord' }],
    actions: [{ type: 'set_category', value: 'Housing' }],
  });
  await storePlanned(mockDb, 'recurrence', '3', {
    title: 'Rent',
    type: 'withdrawal',
    first_date: day,
    nr_of_repetitions: null,
    repetitions: [
      {
        id: '9',
        type: 'monthly',
        moment: dayOfMonth,
        skip: 0,
        weekend: 1,
        occurrences: [`${day}T00:00:00+00:00`],
      },
    ],
    transactions: [
      {
        id: '7',
        amount: '2400.00',
        currency_code: 'PLN',
        source_id: '1',
        source_name: 'Checking',
        destination_name: 'Landlord',
        category_name: 'Housing',
        tags: [],
      },
    ],
  });
}

/** The queued outbox operations, oldest first, with their payloads read back. */
function queued() {
  return mockDb
    .select()
    .from(outboxOperations)
    .all()
    .map((op) => ({ kind: op.kind, payload: JSON.parse(op.payloadJson) }));
}

/** The buttons of the last Alert.alert call: [cancel, confirm]. */
function lastAlertButtons(alert: jest.SpyInstance): { onPress?: () => void }[] {
  const call = alert.mock.calls.at(-1);
  return (call?.[2] ?? []) as { onPress?: () => void }[];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBooked.mockResolvedValue([]);
  mockDb = createTestDb();
});

describe('Planned → Coming up', () => {
  it('lists the next occurrence of a planned transaction', async () => {
    await seedRent(plusDays(3));

    await render(wrap(<PlannedScreen />));

    // One row per occurrence in the window; the first one is the next.
    expect(screen.getAllByText('Rent').length).toBeGreaterThan(0);
  });

  it('tapping an occurrence opens its sheet with Skip and Book it now', async () => {
    const day = plusDays(3);
    await seedRent(day);
    await render(wrap(<PlannedScreen />));

    await fireEvent.press(screen.getAllByText('Rent')[0]!);

    expect(screen.getByText(`${occurrenceLabel(day)} · ${relativeDayLabel(day)}`)).toBeTruthy();
    expect(screen.getByText('Edit the plan')).toBeTruthy();
    expect(screen.getByText('Skip this one')).toBeTruthy();
    expect(screen.getByText('Book it now')).toBeTruthy();
  });

  it('Skip asks first, then queues the day as skipped', async () => {
    const day = plusDays(3);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await seedRent(day);
    await render(wrap(<PlannedScreen />));
    await fireEvent.press(screen.getAllByText('Rent')[0]!);

    await fireEvent.press(screen.getByText('Skip this one'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(queued()).toEqual([]);
    lastAlertButtons(alert)[1]!.onPress!();

    await waitFor(() =>
      expect(queued()).toEqual([
        expect.objectContaining({
          kind: 'save_planned',
          payload: expect.objectContaining({
            fields: expect.objectContaining({ skipDays: [day] }),
          }),
        }),
      ]),
    );
  });

  it('Book it now asks first, then queues trigger_planned for the recurrence', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await seedRent(plusDays(3));
    await render(wrap(<PlannedScreen />));
    await fireEvent.press(screen.getAllByText('Rent')[0]!);

    await fireEvent.press(screen.getByText('Book it now'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(queued()).toEqual([]);
    lastAlertButtons(alert)[1]!.onPress!();

    await waitFor(() =>
      expect(queued()).toEqual([
        expect.objectContaining({
          kind: 'trigger_planned',
          payload: expect.objectContaining({ recurrenceId: '3' }),
        }),
      ]),
    );
  });
});

describe('Planned → Coming up: summary, booking a later occurrence, Booked', () => {
  beforeEach(() => {
    mockBooked.mockResolvedValue([]);
  });

  it('shows the next 30 days out and in in the default currency', async () => {
    await seedRent(plusDays(3));
    await render(wrap(<PlannedScreen />));

    const summary = within(await screen.findByTestId('planned-summary'));
    expect(summary.getByText(i18n.t('planned.summary.out'))).toBeTruthy();
    expect(
      summary.getByText(formatMoney('2400.00', { symbol: 'PLN', decimalPlaces: 2 })),
    ).toBeTruthy();
    expect(
      summary.getByText(`+${formatMoney('0', { symbol: 'PLN', decimalPlaces: 2 })}`),
    ).toBeTruthy();
  });

  it("Book it now is enabled for a later occurrence and queues that occurrence's date", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const day = nearDay();
    await seedRent(day);
    await render(wrap(<PlannedScreen />));

    // Rows are in date order: [0] is this month's, [1] is the one a month later.
    await fireEvent.press(screen.getAllByText('Rent')[1]!);
    await fireEvent.press(screen.getByText('Book it now'));
    expect(alert).toHaveBeenCalledTimes(1);
    lastAlertButtons(alert)[1]!.onPress!();

    await waitFor(() =>
      expect(queued()).toEqual([
        expect.objectContaining({
          kind: 'trigger_planned',
          payload: expect.objectContaining({ recurrenceId: '3', date: monthAfter(day) }),
        }),
      ]),
    );
  });

  it('an occurrence FF3 already booked reads Booked and offers no Book it now', async () => {
    const day = plusDays(3);
    await seedRent(day);
    mockBooked.mockResolvedValue([bookingOn(day)]);
    await render(wrap(<PlannedScreen />));

    expect(await screen.findByText(i18n.t('planned.coming.booked'))).toBeTruthy();
    // Subtitle keeps the route and category even when booked
    expect(screen.getAllByText('Checking → Landlord · Housing').length).toBeGreaterThan(0);

    await fireEvent.press(screen.getAllByText('Rent')[0]!);
    expect(screen.getAllByText(i18n.t('planned.occurrence.booked')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Book it now')).toBeNull();
  });

  it('shows All plans with item count and renders route with category', async () => {
    await seedRent(plusDays(3));
    await render(wrap(<PlannedScreen />));

    expect(screen.getByText('All plans · 1')).toBeTruthy();
    expect(screen.getAllByText('Checking → Landlord · Housing').length).toBeGreaterThan(0);
  });
});
