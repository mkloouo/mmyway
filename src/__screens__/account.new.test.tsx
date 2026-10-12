import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { outboxOperations, referenceAccounts, referenceCurrencies } from '../db/schema';
import { readPayload } from '../sync/payloadJson';
import { confirmAction } from '../ui/confirm';
import type { CreateAccountPayload } from '../accounts/accountCreate';
import NewAccountScreen from '../../app/accounts/new';

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
jest.mock('../ui/confirm', () => ({ confirmAction: jest.fn(async () => true) }));

const SYNCED = '2026-10-11T08:00:00Z';

beforeEach(() => {
  jest.clearAllMocks();
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
});

async function renderScreen() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <NewAccountScreen />
    </SafeAreaProvider>,
  );
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save' });
}

describe('Settings → Accounts → New account screen', () => {
  it('keeps Save disabled until the account has a name', async () => {
    await renderScreen();
    expect(saveButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'Checking');
    expect(saveButton().props.accessibilityState.disabled).toBe(false);
  });

  it('shows the liability fields only for a liability', async () => {
    await renderScreen();
    expect(screen.queryByText('Interest rate (%)')).toBeNull();
    expect(screen.queryByText('Credit limit')).toBeNull();

    await fireEvent.press(screen.getByText('Liability'));
    expect(screen.getByText('Interest rate (%)')).toBeTruthy();
    expect(screen.getByText('Credit limit')).toBeTruthy();

    await fireEvent.press(screen.getByText('Asset'));
    expect(screen.queryByText('Interest rate (%)')).toBeNull();
    expect(screen.queryByText('Credit limit')).toBeNull();
  });

  it('confirms, then queues create_account and shows the account at once', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'Home loan');
    await fireEvent.press(screen.getByText('Liability'));
    await fireEvent.press(screen.getByText('Liability type'));
    await fireEvent.press(screen.getByText('Mortgage'));
    await fireEvent.press(screen.getByText('Direction'));
    await fireEvent.press(screen.getByText('I owe this'));
    // The amount fields, in order: opening balance, interest rate, credit limit.
    const amounts = screen.getAllByPlaceholderText('0');
    await fireEvent.changeText(amounts[1]!, '3,5');
    await fireEvent.changeText(amounts[2]!, '5000');

    await fireEvent.press(saveButton());

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(confirmAction).toHaveBeenCalledTimes(1);

    const ops = mockDb.select().from(outboxOperations).all();
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe('create_account');
    const payload = readPayload<CreateAccountPayload>('create_account', ops[0]!.payloadJson);
    expect(payload.form).toMatchObject({
      name: 'Home loan',
      type: 'liability',
      liabilityType: 'mortgage',
      liabilityDirection: 'debit',
      interest: '3.5',
      virtualBalance: '5000',
    });

    const rows = mockDb.select().from(referenceAccounts).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(payload.clientId);
    expect(payload.clientId.startsWith('mmyway-')).toBe(true);
    expect(rows[0]).toMatchObject({
      name: 'Home loan',
      type: 'liability',
      currencyCode: 'EUR',
      virtualBalance: '5000',
    });
  });

  it('queues nothing when the confirmation is declined', async () => {
    (confirmAction as jest.Mock).mockResolvedValueOnce(false);
    await renderScreen();
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'Checking');

    await fireEvent.press(saveButton());

    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(mockDb.select().from(outboxOperations).all()).toHaveLength(0);
    expect(mockDb.select().from(referenceAccounts).all()).toHaveLength(0);
    expect(router.back).not.toHaveBeenCalled();
  });
});
