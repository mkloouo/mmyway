// The draft's amount keypad (src/ui/AmountSheet.tsx): digits are typed into the sheet and handed
// over once, on close — not written to the database one by one.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import '../i18n';
import { AmountSheet } from '../ui/AmountSheet';

jest.setTimeout(15_000);

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const pln = { symbol: 'zł', decimalPlaces: 2 };

function sheet(onDone: (typed: string | null) => void, visible = true, initial = '12.50') {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <AmountSheet
        visible={visible}
        title="Amount"
        initial={initial}
        currency={pln}
        type="withdrawal"
        onDone={onDone}
      />
    </SafeAreaProvider>
  );
}
const wrap = (ui: ReactElement) => render(ui);

describe('AmountSheet', () => {
  it('shows the amount it opened with and hands nothing over when nothing was typed', async () => {
    const onDone = jest.fn();
    await wrap(sheet(onDone));
    expect(screen.getByText(/12[.,]50/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(onDone).toHaveBeenCalledWith(null);
  });

  it('types onto the amount, shows each digit at once, and commits once on Done', async () => {
    const onDone = jest.fn();
    await wrap(sheet(onDone));
    for (let i = 0; i < 5; i++) await fireEvent.press(screen.getByLabelText('⌫')); // 12.50 → 0
    await fireEvent.press(screen.getByLabelText('7'));
    await fireEvent.press(screen.getByLabelText('5'));
    await fireEvent.press(screen.getByLabelText(','));
    await fireEvent.press(screen.getByLabelText('2'));
    expect(screen.getByText(/75[.,]2/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith('75.2');
  });

  it('starts from the amount again when it is reopened', async () => {
    const onDone = jest.fn();
    const r = await wrap(sheet(onDone));
    await fireEvent.press(screen.getByLabelText('⌫')); // 12.50 → 12.5
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(onDone).toHaveBeenLastCalledWith('12.5');
    await r.rerender(sheet(onDone, false));
    await r.rerender(sheet(onDone, true, '40.00'));
    expect(screen.getByText(/40/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(onDone).toHaveBeenLastCalledWith(null);
  });
});
