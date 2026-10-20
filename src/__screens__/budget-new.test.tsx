// The New envelope sheet, opened from the Budget tab's +. Validation and the create path are the
// ones the old create route had: an empty or duplicate name is refused, and a confirmed create is
// queued as a create_budget operation. New strings are read through i18n.t, so the tests pass
// before and after the locale merge.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '../i18n';
import { createTestDb } from '../db/testDb';
import {
  outboxOperations,
  referenceBudgets,
  referenceCategories,
  referenceCurrencies,
} from '../db/schema';
import { confirmAction } from '../ui/confirm';
import BudgetScreen from '../../app/(tabs)/budget';
import { flagsQuery } from '../flags/useFlag';
import { setFlagOverrides } from '../settings/appSettings';

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
jest.mock('../sync/useSync', () => ({
  usePullToRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }),
}));
jest.mock('../ui/navigateOnce', () => ({ navigateOnce: jest.fn() }));
jest.mock('../ui/confirm', () => ({
  confirmAction: jest.fn(async () => true),
  confirmDestructive: jest.fn(async () => true),
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
  // "Groceries" already has an envelope, so only the other two are suggested.
  mockDb
    .insert(referenceCategories)
    .values([
      { id: 'c1', name: 'Groceries', syncedAt: SYNCED },
      { id: 'c2', name: 'Eating out', syncedAt: SYNCED },
      { id: 'c3', name: 'Salary', syncedAt: SYNCED },
    ])
    .run();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.delete(outboxOperations).run();
});

async function renderTab() {
  // The route reads its flags from the query cache, so load them from the test db before the first render.
  await setFlagOverrides(mockDb as never, { budget: true });
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

// The sheet mounts after the press lands: wait for its name field rather than reading it at once.
async function openSheet() {
  fireEvent.press(screen.getByLabelText('New envelope'));
  return screen.findByPlaceholderText(NAME_PLACEHOLDER);
}

const NAME_PLACEHOLDER = 'e.g. Groceries, Rent';

describe('Budget tab → New envelope sheet', () => {
  it('opens from the + with an empty name field', async () => {
    await renderTab();
    await openSheet();
    expect(screen.getByPlaceholderText(NAME_PLACEHOLDER)).toBeTruthy();
  });

  it('suggests the categories without an envelope, and tapping one fills the name', async () => {
    await renderTab();
    await openSheet();
    expect(await screen.findByText('Eating out')).toBeTruthy();
    expect(screen.getByText('Salary')).toBeTruthy();
    // The tab's own row is the only "Groceries": the category that has an envelope is not offered.
    expect(screen.getAllByText('Groceries')).toHaveLength(1);

    fireEvent.press(screen.getByText('Eating out'));
    expect(await screen.findByDisplayValue('Eating out')).toBeTruthy();
  });

  it('refuses an empty name and a name that already has an envelope', async () => {
    await renderTab();
    await openSheet();
    const input = screen.getByPlaceholderText(NAME_PLACEHOLDER);

    fireEvent.changeText(input, '   ');
    expect(await screen.findByText(i18n.t('budget.emptyNameError'))).toBeTruthy();

    fireEvent.changeText(input, 'groceries');
    expect(
      await screen.findByText(i18n.t('budget.duplicateNameError', { name: 'groceries' })),
    ).toBeTruthy();

    fireEvent.press(screen.getByText(i18n.t('budget.createEnvelope')));
    await waitFor(() => expect(confirmAction).not.toHaveBeenCalled());
    expect(mockDb.select().from(outboxOperations).all()).toHaveLength(0);
  });

  it('queues a confirmed create as a create_budget operation', async () => {
    await renderTab();
    await openSheet();
    fireEvent.changeText(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Holiday');
    await screen.findByDisplayValue('Holiday');
    fireEvent.press(screen.getByText(i18n.t('budget.createEnvelope')));

    await waitFor(() =>
      expect(confirmAction).toHaveBeenCalledWith(
        i18n.t('budget.createTitle'),
        i18n.t('budget.createAction'),
      ),
    );
    await waitFor(() =>
      expect(
        mockDb
          .select()
          .from(outboxOperations)
          .all()
          .map((o) => o.kind),
      ).toEqual(['create_budget']),
    );
    expect(
      mockDb
        .select()
        .from(referenceBudgets)
        .all()
        .map((b) => b.name),
    ).toContain('Holiday');
  });

  it('renders ready to assign line and assigns initial amount when specified', async () => {
    await renderTab();
    await openSheet();

    // Ready to assign line
    expect(screen.getAllByText(/ready to assign/i).length).toBe(2);

    // Header matches board 03
    expect(screen.getByText('Your categories without an envelope')).toBeTruthy();

    // Trailing circle "+" button on suggestion works
    const useBtn = screen.getByLabelText('Use Salary');
    expect(useBtn).toBeTruthy();
    fireEvent.press(useBtn);
    expect(await screen.findByDisplayValue('Salary')).toBeTruthy();

    // Type in Assign now
    const assignPlaceholder = screen.getByPlaceholderText(/optional/i);
    fireEvent.changeText(assignPlaceholder, '250.00');
    await screen.findByDisplayValue('250.00');

    fireEvent.press(screen.getByText(i18n.t('budget.createEnvelope')));

    await waitFor(() =>
      expect(
        mockDb
          .select()
          .from(outboxOperations)
          .all()
          .map((o) => o.kind),
      ).toEqual(['create_budget', 'set_budget_limits']),
    );
  });
});
