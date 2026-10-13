// Settings → Rules and its New rule sheet. SQLite is real (better-sqlite3, src/db/testDb.ts); the
// live-query subscription, the confirm prompt and expo-router are shimmed, as in settings.demo.test.tsx.
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { outboxOperations, referenceBudgets, referenceCategories } from '../db/schema';
import { flagsQuery } from '../flags/useFlag';
import { setFlagOverrides } from '../settings/appSettings';
import { storePlanned } from '../planned/objects';
import { enqueueOperation } from '../sync/outbox';
import { confirmAction } from '../ui/confirm';
import RulesScreen from '../../app/settings/rules';

// `mock`-prefixed so Jest's hoisting lets the factories below close over them.
let mockDb: ReturnType<typeof createTestDb>;
let mockClient: QueryClient;
let mockParams: Record<string, string | undefined> = {};

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

// The real hook subscribes to expo-sqlite's change events, which Jest has no native module for.
jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

// expo-router pulls in an untransformed ESM dependency under Jest; the navigation isn't under test.
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../ui/confirm', () => ({
  confirmAction: jest.fn(),
  confirmDestructive: jest.fn(),
}));

const T = '2026-01-01T00:00:00Z';
const RUN_BODY = 'Applies it to the last year of transactions in Firefly III on the next sync.';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

configure({ asyncUtilTimeout: 10_000 });

function wrap(ui: ReactElement) {
  return (
    <QueryClientProvider client={mockClient}>
      <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>
    </QueryClientProvider>
  );
}

/** One group, "Imports", with one rule, "Coffee", that matches "starbucks". */
async function seedRules(ruleActive = true) {
  await storePlanned(mockDb, 'rule_group', 'g1', { title: 'Imports', active: true, order: 1 });
  await storePlanned(mockDb, 'rule', 'r1', {
    title: 'Coffee',
    rule_group_id: 'g1',
    active: ruleActive,
    order: 1,
    triggers: [{ type: 'description_contains', value: 'starbucks', active: true }],
    actions: [{ type: 'set_category', value: 'Coffee', active: true }],
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

beforeEach(async () => {
  jest.clearAllMocks();
  mockDb = createTestDb();
  mockParams = {};
  (confirmAction as jest.Mock).mockResolvedValue(true);
  // The page is behind ff3_rules (off by default). Its flags are loaded before each render, since
  // the route renders nothing until they are in the cache.
  await setFlagOverrides(mockDb, { ff3_rules: true });
  mockClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await mockClient.prefetchQuery(flagsQuery(mockDb));
});

afterEach(() => {
  // Empties the cache, so its garbage-collection timer doesn't keep Jest waiting after the run.
  mockClient.clear();
});

describe('Settings → Rules', () => {
  it('shows each group with its rules and their first trigger', async () => {
    await seedRules();

    await render(wrap(<RulesScreen />));

    expect(screen.getByText('Imports')).toBeTruthy();
    expect(screen.getByText('Coffee')).toBeTruthy();
    expect(screen.getByText('starbucks')).toBeTruthy();
  });

  it('a switch queues toggle_rule and shows the new value', async () => {
    await seedRules();
    await render(wrap(<RulesScreen />));

    fireEvent(screen.getByLabelText('Coffee'), 'valueChange', false);

    await waitFor(() =>
      expect(queued()).toEqual([
        expect.objectContaining({
          kind: 'toggle_rule',
          payload: expect.objectContaining({ ruleId: 'r1', active: false }),
        }),
      ]),
    );
    await waitFor(() => expect(screen.getByLabelText('Coffee').props.value).toBe(false));
  });

  it('a queued toggle overrides a stale cached value', async () => {
    // The cache still says on (a pull ran before the replay); the queued switch says off.
    await seedRules(true);
    await enqueueOperation(mockDb, {
      id: 'op-toggle',
      kind: 'toggle_rule',
      payload: { ruleId: 'r1', active: false },
    });

    await render(wrap(<RulesScreen />));

    expect(screen.getByLabelText('Coffee').props.value).toBe(false);
  });

  it('Run now asks first, then queues trigger_rule', async () => {
    await seedRules();
    await render(wrap(<RulesScreen />));

    fireEvent.press(screen.getByText('Run now'));

    expect(confirmAction).toHaveBeenCalledWith('Run "Coffee" now?', 'Run now', RUN_BODY);
    await waitFor(() =>
      expect(queued()).toEqual([
        expect.objectContaining({
          kind: 'trigger_rule',
          payload: expect.objectContaining({ ruleId: 'r1' }),
        }),
      ]),
    );
  });

  it('Run now queues nothing when the confirm is cancelled', async () => {
    (confirmAction as jest.Mock).mockResolvedValue(false);
    await seedRules();
    await render(wrap(<RulesScreen />));

    fireEvent.press(screen.getByText('Run now'));

    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(queued()).toEqual([]);
  });
});

describe('Settings → Rules → New rule sheet', () => {
  const saveButton = () => screen.getByRole('button', { name: 'Save' });

  it('+ opens an empty sheet; a category picked inside it shows back on the fields', async () => {
    mockDb.insert(referenceCategories).values({ id: 'c1', name: 'Groceries', syncedAt: T }).run();
    await render(wrap(<RulesScreen />));

    fireEvent.press(screen.getByLabelText('New rule'));

    await waitFor(() => expect(saveButton().props.accessibilityState.disabled).toBe(true));
    fireEvent.press(screen.getByText('Category'));
    await waitFor(() => expect(screen.getByText('Groceries')).toBeTruthy());
    fireEvent.press(screen.getByText('Groceries'));
    // Back on the fields, with the choice shown on its row.
    await waitFor(() => expect(screen.getByText('Category')).toBeTruthy());
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(saveButton()).toBeTruthy();
  });

  it('Save stays off without a category or budget, and queues create_rule once one is set', async () => {
    mockParams = { match: 'Lidl' };
    mockDb.insert(referenceCategories).values({ id: 'c1', name: 'Groceries', syncedAt: T }).run();
    await render(wrap(<RulesScreen />));

    expect(saveButton().props.accessibilityState.disabled).toBe(true);

    // An empty match is not valid either, even with a title.
    fireEvent.changeText(screen.getAllByDisplayValue('Lidl')[1]!, '  ');
    expect(saveButton().props.accessibilityState.disabled).toBe(true);
  });

  it('creates a category rule from the params, with the match as its trigger', async () => {
    mockParams = { match: 'Lidl', category: 'Groceries' };
    await render(wrap(<RulesScreen />));

    expect(saveButton().props.accessibilityState.disabled).toBe(false);
    fireEvent.press(saveButton());

    await waitFor(() =>
      expect(confirmAction).toHaveBeenCalledWith(
        'Create this rule?',
        'Save',
        'It is queued and sent to Firefly III on the next sync.',
      ),
    );
    await waitFor(() => expect(queued()).toHaveLength(1));
    expect(queued()[0]).toMatchObject({
      kind: 'create_rule',
      payload: {
        title: 'Lidl',
        triggers: [{ type: 'description_contains', value: 'Lidl' }],
        actions: [{ type: 'set_category', value: 'Groceries' }],
      },
    });
    // The sheet closes once the rule is queued.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
  });

  it('is prefilled from the params and sets both category and budget', async () => {
    mockParams = { match: 'Starbucks', category: 'Coffee', budget: 'Fun' };
    mockDb
      .insert(referenceBudgets)
      .values([
        { id: 'b1', name: 'Fun', active: true, syncedAt: T },
        { id: 'b2', name: 'Old', active: false, syncedAt: T },
      ])
      .run();
    await render(wrap(<RulesScreen />));

    // Title and "Description contains" both default to the match.
    expect(screen.getAllByDisplayValue('Starbucks')).toHaveLength(2);
    expect(screen.getByText('Coffee')).toBeTruthy();
    expect(screen.getByText('Fun')).toBeTruthy();
    expect(saveButton().props.accessibilityState.disabled).toBe(false);

    fireEvent.press(saveButton());

    await waitFor(() => expect(queued()).toHaveLength(1));
    expect(queued()[0]).toMatchObject({
      kind: 'create_rule',
      payload: {
        title: 'Starbucks',
        triggers: [{ type: 'description_contains', value: 'Starbucks' }],
        actions: [
          { type: 'set_category', value: 'Coffee' },
          { type: 'set_budget', value: 'Fun' },
        ],
      },
    });
  });
});
