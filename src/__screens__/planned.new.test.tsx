// New planned payment (app/planned/new.tsx): the three steps walk through to Create, and what gets
// queued is the save the item page queues for a new one (blank form, savePlanned, nothing before
// Create). The reminder sheet is due after the first one; leaving a half-filled form asks first.
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import i18n from '../i18n';
import { createTestDb } from '../db/testDb';
import { outboxOperations, referenceAccounts, referenceCurrencies } from '../db/schema';
import { readPayload } from '../sync/payloadJson';
import { normkey } from '../lookup/normkey';
import { getReminderOverrides } from '../settings/appSettings';
import { defaultRepetition } from '../planned/repetition';
import { localDay } from '../utils/day';
import type { SavePlannedPayload } from '../planned/replay';
import type { MerchantHistory } from '../lookup/merchantLookup';
import NewPlannedScreen from '../../app/planned/new';

jest.setTimeout(15_000);

let mockDb: ReturnType<typeof createTestDb>;
let mockHistories: MerchantHistory[] = [];

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

jest.mock('../lookup/useMerchantHistories', () => ({
  useMerchantHistories: () => mockHistories,
}));

jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('../planned/notifications', () => ({
  syncPlannedNotifications: jest.fn(async () => undefined),
}));

const SYNCED = '2026-10-11T08:00:00Z';

beforeEach(() => {
  jest.clearAllMocks();
  mockHistories = [];
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
      <NewPlannedScreen />
    </SafeAreaProvider>,
  );
}

async function queuedSaves() {
  const ops = await mockDb.select().from(outboxOperations);
  return ops.map((op) => ({
    kind: op.kind,
    payload: readPayload<SavePlannedPayload>(op.kind, op.payloadJson),
  }));
}

describe('New planned payment', () => {
  it('walks What, When and Check, then queues the save a new payment queues', async () => {
    await renderScreen();
    // Continue is off until the step's fields are valid.
    await fireEvent.press(screen.getByText(i18n.t('account.continue')));
    expect(screen.queryByText(i18n.t('planned.repTypeLabel'))).toBeNull();

    await fireEvent.press(screen.getByText(i18n.t('capture.typeTransfer')));
    await fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('planned.namePlaceholder')),
      'Savings top-up',
    );
    await fireEvent.press(screen.getByText(i18n.t('fields.amount')));
    for (const key of ['1', '2', '5']) await fireEvent.press(screen.getByLabelText(key));
    await fireEvent.press(screen.getByLabelText(i18n.t('common.done')));

    // The default currency lands once the reference data has loaded.
    await waitFor(() => expect(screen.getByText('PLN')).toBeTruthy());

    await fireEvent.press(screen.getByText(i18n.t('fields.from')));
    await fireEvent.press(screen.getByText('Checking'));
    await fireEvent.press(screen.getByText(i18n.t('fields.to')));
    await fireEvent.press(screen.getByText('Savings'));

    // Step 1 → 2: How often starts on Monthly, the same default the item page gives.
    await fireEvent.press(screen.getByText(i18n.t('account.continue')));
    expect(screen.getByText(i18n.t('planned.repTypeLabel'))).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: i18n.t('planned.repType.monthly') }).props
        .accessibilityState,
    ).toEqual({ checked: true });

    // Step 2 → 3. Remind me: Off for this payment, stored under its name's key once created.
    await fireEvent.press(screen.getByText(i18n.t('account.continue')));
    await fireEvent.press(screen.getByText(i18n.t('planned.remind.title')));
    await fireEvent.press(screen.getByText(i18n.t('planned.remind.off')));
    await fireEvent.press(screen.getByText(i18n.t('planned.new.create')));

    await waitFor(async () => expect(await queuedSaves()).toHaveLength(1));
    const [save] = await queuedSaves();
    expect(save!.kind).toBe('save_planned');
    expect(save!.payload.key).toMatch(/^new:/);
    expect(save!.payload.before).toBeNull();
    expect(save!.payload.billId).toBeNull();
    expect(save!.payload.ruleId).toBeNull();
    expect(save!.payload.recurrenceId).toBeNull();
    expect(save!.payload.fields).toEqual({
      name: 'Savings top-up',
      type: 'transfer',
      sourceId: 'a1',
      sourceName: 'Checking',
      destinationId: 'a3',
      destinationName: 'Savings',
      amount: '125',
      currencyCode: 'PLN',
      notes: null,
      repeats: true,
      repetitions: [defaultRepetition(localDay())],
      end: { kind: 'forever' },
      date: localDay(),
      time: null,
      skipDays: [],
      categoryName: null,
      tags: [],
    });
    expect(await getReminderOverrides(mockDb)).toEqual({ [normkey('Savings top-up')]: 'off' });
    // The first payment asks about reminders once; "Not now" then goes back to the Planned tab.
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText(i18n.t('reminders.notNow')));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('asks before leaving with something entered, and leaves straight away when empty', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByLabelText(i18n.t('common.cancel')));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);

    await fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('planned.namePlaceholder')),
      'Gym',
    );
    await fireEvent.press(screen.getByLabelText(i18n.t('common.cancel')));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(await queuedSaves()).toHaveLength(0);
  });

  it('keeps the user-chosen account when picking a payee with a different usual account', async () => {
    mockHistories = [
      {
        merchantKey: 'landlord',
        displayName: 'Landlord',
        topAccountName: 'Checking',
        topCategory: 'Housing',
        topBudgetName: null,
        occurrences: 5,
        lastUsed: '2026-10-10',
      },
    ];

    await renderScreen();
    await waitFor(() => expect(screen.getByText('PLN')).toBeTruthy());

    // User explicitly picks Savings for From
    await fireEvent.press(screen.getByText(i18n.t('fields.from')));
    await fireEvent.press(screen.getByText('Savings'));
    expect(screen.getByText('Savings')).toBeTruthy();

    // User picks Landlord (whose topAccountName is Checking)
    await fireEvent.press(screen.getByText(i18n.t('fields.to')));
    await fireEvent.press(screen.getAllByText('Landlord')[0]!);

    // The chosen account stays Savings, not reverted to Checking
    expect(screen.getByText('Savings')).toBeTruthy();
    expect(screen.getAllByText('Landlord').length).toBeGreaterThan(0);
    expect(screen.getByText('Housing')).toBeTruthy();
  });
});
