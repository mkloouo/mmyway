import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import '../i18n';
import { CashSweepPickers } from './CashSweepPickers';
import type { AccountPickerAccount } from '../accounts/useAssetAccounts';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function wrap(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

const EXPENSES: AccountPickerAccount[] = [
  { id: 'e1', name: 'Aldi', currencyCode: 'PLN' },
  { id: 'e2', name: 'Biedronka', currencyCode: 'PLN' },
  { id: 'e3', name: 'Cash shortfall', currencyCode: 'PLN' },
];

const REVENUES: AccountPickerAccount[] = [
  { id: 'r1', name: 'Cash surplus', currencyCode: 'PLN' },
  { id: 'r2', name: 'Found cash', currencyCode: 'PLN' },
];

describe('CashSweepPickers', () => {
  it('renders shortfall picker with board 28 title, subtitle, and segmented filter', async () => {
    const onSelectShortfall = jest.fn();
    await wrap(
      <CashSweepPickers
        picker="shortfall"
        onClose={jest.fn()}
        expenseAccounts={EXPENSES}
        usedExpenseAccounts={[EXPENSES[0]!]}
        revenueAccounts={REVENUES}
        usedRevenueAccounts={[]}
        currencies={[{ code: 'PLN', symbol: 'zł', decimalPlaces: 2 }]}
        selectedShortfallId="e3"
        onSelectShortfall={onSelectShortfall}
        onSelectSurplus={jest.fn()}
      />,
    );

    expect(screen.getByText('Missing cash goes to')).toBeTruthy();
    expect(screen.getByText('One of 3 expense accounts')).toBeTruthy();
    expect(screen.getByText('Used this year · 1')).toBeTruthy();
    expect(screen.getByText('All · 3')).toBeTruthy();

    // Chosen account is listed under Chosen
    expect(screen.getByText('Chosen')).toBeTruthy();
    expect(screen.getByText('Cash shortfall')).toBeTruthy();

    // In 'Used this year' tab, only e1 (Aldi) is present among remaining candidates
    expect(screen.getByText('Aldi')).toBeTruthy();
    expect(screen.queryByText('Biedronka')).toBeNull();

    // Switch to 'All' tab
    await fireEvent.press(screen.getByText('All · 3'));
    expect(screen.getByText('Biedronka')).toBeTruthy();

    // Select an account
    await fireEvent.press(screen.getByText('Biedronka'));
    expect(onSelectShortfall).toHaveBeenCalledWith(EXPENSES[1]);
  });

  it('renders surplus picker with board 28 title and revenue subtitle', async () => {
    const onSelectSurplus = jest.fn();
    await wrap(
      <CashSweepPickers
        picker="surplus"
        onClose={jest.fn()}
        expenseAccounts={EXPENSES}
        usedExpenseAccounts={[]}
        revenueAccounts={REVENUES}
        usedRevenueAccounts={[REVENUES[0]!]}
        currencies={[{ code: 'PLN', symbol: 'zł', decimalPlaces: 2 }]}
        selectedSurplusId="r1"
        onSelectShortfall={jest.fn()}
        onSelectSurplus={onSelectSurplus}
      />,
    );

    expect(screen.getByText('Extra cash comes from')).toBeTruthy();
    expect(screen.getByText('One of 2 revenue accounts')).toBeTruthy();

    await fireEvent.press(screen.getByText('Cash surplus'));
    expect(onSelectSurplus).toHaveBeenCalledWith(REVENUES[0]);
  });
});
