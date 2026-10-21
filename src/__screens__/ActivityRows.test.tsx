import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { ActivityRow, BalanceStrip, DayHeader } from '../ui/ActivityRows';
import type { ActivityCachedRow, Currencies } from '../transactions/activityRows';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('../ui/navigateOnce', () => ({
  navigateOnce: jest.fn(),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function wrap(node: React.ReactElement) {
  return <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>;
}

const mockCurrencies = [
  { code: 'PLN', symbol: 'zł', decimalPlaces: 2, isDefault: true, enabled: true, syncedAt: '' },
  { code: 'EUR', symbol: '€', decimalPlaces: 2, isDefault: false, enabled: true, syncedAt: '' },
] as unknown as Currencies;

describe('ActivityRows', () => {
  it('renders normal expense row with description, category, and formatted amount', async () => {
    const item = {
      groupId: 'grp-1',
      description: 'Żabka',
      amount: '12.50',
      currencyCode: 'PLN',
      type: 'withdrawal',
      sourceId: 'acc-1',
      destinationId: 'acc-2',
      sourceName: 'Checking',
      destinationName: 'Żabka',
      categoryName: 'Groceries',
      splitCount: 1,
      splitsJson: null,
    } as unknown as ActivityCachedRow;

    await render(
      wrap(
        <ActivityRow
          item={item}
          selecting={false}
          selected={false}
          currencies={mockCurrencies}
          onPress={jest.fn()}
          onLongPress={jest.fn()}
          isFirst
          isLast
        />,
      ),
    );

    expect(screen.getByText('Żabka')).toBeTruthy();
    expect(screen.getByText('Groceries · Żabka')).toBeTruthy();
    expect(screen.getByText('−12.50 zł')).toBeTruthy();
  });

  it('renders transfer with source -> destination in subtitle', async () => {
    const item = {
      groupId: 'grp-2',
      description: 'To savings',
      amount: '100.00',
      currencyCode: 'PLN',
      type: 'transfer',
      sourceId: 'acc-1',
      destinationId: 'acc-2',
      sourceName: 'Checking',
      destinationName: 'Savings EUR',
      categoryName: null,
      splitCount: 1,
      splitsJson: null,
    } as unknown as ActivityCachedRow;

    await render(
      wrap(
        <ActivityRow
          item={item}
          selecting={false}
          selected={false}
          currencies={mockCurrencies}
          onPress={jest.fn()}
          onLongPress={jest.fn()}
          isFirst
          isLast={false}
        />,
      ),
    );

    expect(screen.getByText('To savings')).toBeTruthy();
    expect(screen.getByText('Checking → Savings EUR')).toBeTruthy();
    expect(screen.getByText('100.00 zł')).toBeTruthy();
  });

  it('renders deposit with positive amount', async () => {
    const item = {
      groupId: 'grp-3',
      description: 'Salary',
      amount: '5000.00',
      currencyCode: 'PLN',
      type: 'deposit',
      sourceId: 'acc-ext',
      destinationId: 'acc-1',
      sourceName: 'Employer',
      destinationName: 'Checking',
      categoryName: 'Salary',
      splitCount: 1,
      splitsJson: null,
    } as unknown as ActivityCachedRow;

    await render(
      wrap(
        <ActivityRow
          item={item}
          selecting={false}
          selected={false}
          currencies={mockCurrencies}
          onPress={jest.fn()}
          onLongPress={jest.fn()}
        />,
      ),
    );

    expect(screen.getByText('Salary')).toBeTruthy();
    expect(screen.getByText('+5,000.00 zł')).toBeTruthy();
  });

  it('renders BalanceStrip accounts and formats balances', async () => {
    const accounts = [
      {
        id: 'acc-1',
        name: 'Checking',
        currencyCode: 'PLN',
        currentBalance: '1500.50',
        currentBalanceDate: '2026-10-10',
        active: true,
        type: 'asset',
        order: 1,
      },
      {
        id: 'acc-2',
        name: 'Cash wallet',
        currencyCode: 'PLN',
        currentBalance: '250.00',
        currentBalanceDate: '2026-10-10',
        active: true,
        type: 'asset',
        order: 2,
      },
    ] as unknown as ReferenceAccountRow[];

    await render(
      wrap(
        <BalanceStrip
          accounts={accounts}
          selectedId="acc-2"
          onToggle={jest.fn()}
          currencies={mockCurrencies}
          pendingAccounts={new Set(['acc-2'])}
        />,
      ),
    );

    expect(screen.getByText('Checking')).toBeTruthy();
    expect(screen.getByText('1,500.50 zł')).toBeTruthy();
    expect(screen.getByText('Cash wallet')).toBeTruthy();
    expect(screen.getByText('250.00 zł')).toBeTruthy();
  });

  it('renders DayHeader with totals', async () => {
    await render(
      wrap(
        <DayHeader
          sectionKey="2026-10-10"
          totals={[{ currencyCode: 'PLN', amount: '-104.37' }]}
          currencies={mockCurrencies}
        />,
      ),
    );

    expect(screen.getByText('−104.37 zł')).toBeTruthy();
  });

  it('renders QUEUED pill for queued row', async () => {
    const item = {
      queued: true,
      groupId: 'op-1',
      description: 'Coffee',
      amount: '20.00',
      currencyCode: 'PLN',
      type: 'withdrawal',
      sourceId: 'acc-1',
      destinationId: 'acc-2',
      sourceName: 'Checking',
      destinationName: 'Costa',
      categoryName: 'Eating out',
      splits: [],
    } as unknown as ActivityCachedRow;

    await render(
      wrap(
        <ActivityRow
          item={item}
          selecting={false}
          selected={false}
          currencies={mockCurrencies}
          onPress={jest.fn()}
          onLongPress={jest.fn()}
        />,
      ),
    );

    expect(screen.getByText('QUEUED')).toBeTruthy();
  });

  it('renders EDITED pill for pending edit row', async () => {
    const item = {
      groupId: 'grp-4',
      description: 'Fuel',
      amount: '250.00',
      currencyCode: 'PLN',
      type: 'withdrawal',
      sourceId: 'acc-1',
      destinationId: 'acc-2',
      sourceName: 'Checking',
      destinationName: 'Orlen',
      categoryName: 'Car',
      splitCount: 1,
      splitsJson: null,
      pendingStatus: 'queued',
    } as unknown as ActivityCachedRow;

    await render(
      wrap(
        <ActivityRow
          item={item}
          selecting={false}
          selected={false}
          currencies={mockCurrencies}
          onPress={jest.fn()}
          onLongPress={jest.fn()}
        />,
      ),
    );

    expect(screen.getByText('EDITED')).toBeTruthy();
  });
});
