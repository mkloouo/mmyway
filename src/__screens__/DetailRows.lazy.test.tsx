// A page holds four sheets (category, budget, account, note). Building the option lists of the
// ones nobody opened made every page of a receipt heavier; a sheet is built when first opened.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { DetailRows, type DetailRowsValue } from '../ui/DetailRows';

jest.setTimeout(15_000);

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const value: DetailRowsValue = {
  type: 'withdrawal',
  categoryName: null,
  sourceAccountId: null,
  destinationAccountId: null,
  budgetId: null,
  dateLabel: 'Today',
  notes: null,
  sharedWith: null,
};

function rows(onChange = jest.fn(), categories = [{ id: '1', name: 'Groceries' }]) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <DetailRows
        value={value}
        onChange={onChange}
        onDatePress={jest.fn()}
        accounts={[]}
        currencies={[]}
        categories={categories}
        budgets={[{ id: 'b1', name: 'Food' }]}
      />
    </SafeAreaProvider>
  );
}

describe('DetailRows sheets', () => {
  it('builds no category option until the sheet is opened', async () => {
    const categories = [{ id: '1', name: 'Groceries' }];
    const mapSpy = jest.spyOn(categories, 'map');
    await render(rows(jest.fn(), categories));
    expect(mapSpy).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Category'));
    expect(mapSpy).toHaveBeenCalled();
    expect(screen.getByText('Groceries')).toBeTruthy();
  });

  it('hands over the note once, when the sheet closes — not per letter', async () => {
    const onChange = jest.fn();
    await render(rows(onChange));
    await fireEvent.press(screen.getByText('Description'));
    const field = screen.getAllByDisplayValue('')[0]!;
    await fireEvent(field, 'focus');
    await fireEvent.changeText(field, 'Bo');
    await fireEvent.changeText(field, 'Bought milk');
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Done'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ notes: 'Bought milk' });
  });
});

describe('DetailRows payee row', () => {
  function withPayee(type: DetailRowsValue['type'], onPress = jest.fn()) {
    return (
      <SafeAreaProvider initialMetrics={metrics}>
        <DetailRows
          value={{ ...value, type }}
          onChange={jest.fn()}
          onDatePress={jest.fn()}
          payee={{ name: 'Żabka', onPress }}
          accounts={[]}
          currencies={[]}
          categories={[]}
          budgets={[]}
        />
      </SafeAreaProvider>
    );
  }

  it('shows the payee of an expense as a row that opens the picker', async () => {
    const onPress = jest.fn();
    await render(withPayee('withdrawal', onPress));
    expect(screen.getByText('Żabka')).toBeTruthy();
    await fireEvent.press(screen.getByText('Payee'));
    expect(onPress).toHaveBeenCalled();
  });

  it('calls it the payer on an income', async () => {
    await render(withPayee('deposit'));
    expect(screen.getByText('Payer')).toBeTruthy();
  });

  it('leaves it off a transfer', async () => {
    await render(withPayee('transfer'));
    expect(screen.queryByText('Payee')).toBeNull();
    expect(screen.queryByText('Żabka')).toBeNull();
  });
});
