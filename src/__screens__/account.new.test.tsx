import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { outboxOperations, referenceAccounts, referenceCurrencies } from '../db/schema';
import { readPayload } from '../sync/payloadJson';
import { confirmAction } from '../ui/confirm';
import type { CreateAccountPayload } from '../accounts/accountCreate';
import NewAccountScreen from '../../app/accounts/new';
import { flagsQuery } from '../flags/useFlag';
import { setFlagOverrides } from '../settings/appSettings';

jest.setTimeout(15_000);

let mockDb: ReturnType<typeof createTestDb>;
let mockParams: Record<string, string | undefined> = {};

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
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
  mockParams = {};
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
  // The route reads its flags from the query cache, so load them from the test db before the first render.
  await setFlagOverrides(mockDb as never, { account_create: true });
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
        <NewAccountScreen />
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
}

// The step-1 and step-2 buttons are found by their wrapper's testID: their labels are new strings.
function continueButton() {
  return within(screen.getByTestId('new-account-continue')).getByRole('button');
}

function createButton() {
  return within(screen.getByTestId('new-account-create')).getByRole('button');
}

describe('Settings → Accounts → New account screen', () => {
  it('keeps Continue disabled until the account has a name', async () => {
    await renderScreen();
    expect(continueButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'Checking');
    expect(continueButton().props.accessibilityState.disabled).toBe(false);
  });

  it('shows the liability fields only on step 2 for a liability', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'Checking');
    await fireEvent.press(screen.getByTestId('kind-liability'));
    await fireEvent.press(screen.getByText('Liability type'));
    await fireEvent.press(screen.getByText('Loan'));
    await fireEvent.press(continueButton());
    expect(screen.getByText('Interest rate (%)')).toBeTruthy();
    expect(screen.getByText('Credit limit')).toBeTruthy();

    // Change goes back to step 1, where the liability fields are not shown.
    await fireEvent.press(screen.getByTestId('new-account-change'));
    expect(screen.queryByText('Interest rate (%)')).toBeNull();
    expect(screen.queryByText('Credit limit')).toBeNull();

    await fireEvent.press(screen.getByTestId('kind-asset'));
    await fireEvent.press(continueButton());
    expect(screen.queryByText('Interest rate (%)')).toBeNull();
    expect(screen.queryByText('Credit limit')).toBeNull();
  });

  it('starts on Liability when opened with type=liability (Settings → Liabilities +)', async () => {
    mockParams = { type: 'liability' };
    await renderScreen();
    expect(screen.getByTestId('kind-liability').props.accessibilityState.checked).toBe(true);
    expect(screen.queryByText('Account role')).toBeNull();
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'Home loan');
    await fireEvent.press(screen.getByText('Liability type'));
    await fireEvent.press(screen.getByText('Loan'));
    await fireEvent.press(continueButton());
    expect(screen.getByText('Interest rate (%)')).toBeTruthy();
  });

  it('confirms, then queues create_account and shows the account at once', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByPlaceholderText('Name'), 'Home loan');
    await fireEvent.press(screen.getByTestId('kind-liability'));
    await fireEvent.press(screen.getByText('Liability type'));
    await fireEvent.press(screen.getByText('Mortgage'));
    await fireEvent.press(continueButton());

    await fireEvent.press(screen.getByText('Direction'));
    await fireEvent.press(screen.getByText('I owe this'));
    // The amount fields, in order: opening balance, interest rate, credit limit.
    const amounts = screen.getAllByPlaceholderText('0');
    await fireEvent.changeText(amounts[1]!, '3,5');
    await fireEvent.changeText(amounts[2]!, '5000');

    await fireEvent.press(createButton());

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

    await fireEvent.press(continueButton());
    await fireEvent.press(createButton());

    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(mockDb.select().from(outboxOperations).all()).toHaveLength(0);
    expect(mockDb.select().from(referenceAccounts).all()).toHaveLength(0);
    expect(router.back).not.toHaveBeenCalled();
  });
});
