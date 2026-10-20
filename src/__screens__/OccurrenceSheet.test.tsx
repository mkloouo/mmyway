import { fireEvent, render, screen } from '@testing-library/react-native';
import { type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { createTestDb } from '../db/testDb';
import { OccurrenceSheet, type Occurrence } from '../ui/OccurrenceSheet';
import type { PlannedItem } from '../planned/items';
import { occurrenceLabel, relativeDayLabel, scheduleLabel } from '../planned/labels';

let mockDb: ReturnType<typeof createTestDb>;
jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));
jest.mock('../db/useLiveQuery', () => ({
  sameRows: () => false,
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all() }),
}));

const mockNavigateOnce = jest.fn();
jest.mock('../ui/navigateOnce', () => ({
  navigateOnce: (path: string) => mockNavigateOnce(path),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>
    </QueryClientProvider>
  );
}

const item: PlannedItem = {
  key: 'Rent',
  queued: false,
  fields: {
    name: 'Rent',
    amount: '2400.00',
    currencyCode: 'PLN',
    type: 'withdrawal',
    date: '2026-10-15',
    repeats: true,
    repetitions: [
      {
        id: '1',
        type: 'monthly',
        moment: '15',
        skip: 0,
        weekend: 1,
      },
    ],
    end: { kind: 'forever' },
    sourceId: '1',
    destinationId: null,
    sourceName: 'Checking',
    destinationName: 'Landlord',
    categoryName: 'Housing',
    skipDays: [],
    time: null,
    notes: null,
    tags: [],
  },
  group: {
    key: 'Rent',
    name: 'Rent',
    recurrence: {
      key: 'Rent',
      kind: 'recurrence',
      id: '3',
      name: 'Rent',
      attributes: {
        title: 'Rent',
        type: 'withdrawal',
        first_date: '2026-10-15',
        repeat_until: null,
        nr_of_repetitions: null,
        apply_rules: true,
        active: true,
        notes: null,
        repetitions: [
          {
            id: '1',
            type: 'monthly',
            moment: '15',
            skip: 0,
            weekend: 1,
            occurrences: ['2026-10-15T00:00:00+00:00'],
            description: 'Monthly on the 15th',
          },
        ],
        transactions: [],
      },
    },
  },
};

describe('OccurrenceSheet', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = createTestDb();
  });

  it('renders V4 board 21 layout: title, subtitle, 3 rows, Edit the plan row, footer buttons', async () => {
    const occurrence: Occurrence = {
      item,
      day: '2026-10-15',
      skipped: false,
    };
    const onClose = jest.fn();

    await render(
      wrap(
        <OccurrenceSheet visible={true} occurrence={occurrence} booked={false} onClose={onClose} />,
      ),
    );

    // Title and subtitle in Sheet header
    expect(screen.getByText('Rent')).toBeTruthy();
    const expectedSub = `${occurrenceLabel('2026-10-15')} · ${relativeDayLabel('2026-10-15')}`;
    expect(screen.getByText(expectedSub)).toBeTruthy();

    // Group 1: From, To, Category (Date and Status dropped)
    expect(screen.getByText('Checking')).toBeTruthy();
    expect(screen.getByText('Landlord')).toBeTruthy();
    expect(screen.getByText('Housing')).toBeTruthy();
    expect(screen.queryByText('Status')).toBeNull();

    // Group 2: Edit the plan with scheduleLabel as sub
    expect(screen.getByText('Edit the plan')).toBeTruthy();
    expect(screen.getByText(scheduleLabel(item.fields, item.group))).toBeTruthy();

    // Footer: Skip this one + Book it now
    expect(screen.getByText(/Skip.*this.*one/)).toBeTruthy();
    expect(screen.getByText(/Book.*it.*now/)).toBeTruthy();
  });

  it('tapping Edit the plan closes sheet and navigates to planned item', async () => {
    const occurrence: Occurrence = {
      item,
      day: '2026-10-15',
      skipped: false,
    };
    const onClose = jest.fn();

    await render(
      wrap(
        <OccurrenceSheet visible={true} occurrence={occurrence} booked={false} onClose={onClose} />,
      ),
    );

    fireEvent.press(screen.getByText('Edit the plan'));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigateOnce).toHaveBeenCalledWith('/planned/Rent');
  });

  it('renders unskip action when occurrence is skipped', async () => {
    const occurrence: Occurrence = {
      item,
      day: '2026-10-15',
      skipped: true,
    };

    await render(
      wrap(
        <OccurrenceSheet
          visible={true}
          occurrence={occurrence}
          booked={false}
          onClose={jest.fn()}
        />,
      ),
    );

    expect(screen.getByText(/Book.*it.*after.*all/)).toBeTruthy();
  });

  it('hides Book it now when already booked', async () => {
    const occurrence: Occurrence = {
      item,
      day: '2026-10-15',
      skipped: false,
    };

    await render(
      wrap(
        <OccurrenceSheet
          visible={true}
          occurrence={occurrence}
          booked={true}
          onClose={jest.fn()}
        />,
      ),
    );

    expect(screen.queryByText(/Book.*it.*now/)).toBeNull();
  });
});
