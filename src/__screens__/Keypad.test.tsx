// The keypad (src/ui/Keypad.tsx): Capture's full keypad (digits, decimal, backspace) and the
// compact one the amount sheets use (with its confirm cell).
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { Keypad } from '../ui/Keypad';

jest.setTimeout(15_000);

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function wrap(node: React.ReactElement) {
  return <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>;
}

describe('Keypad', () => {
  it('draws digits, decimal and backspace only, with no More, date or save key', async () => {
    await render(wrap(<Keypad onDigit={jest.fn()} />));
    expect(screen.getByTestId('keypad-1')).toBeTruthy();
    expect(screen.getByTestId('keypad-decimal')).toBeTruthy();
    expect(screen.getByTestId('keypad-backspace')).toBeTruthy();
    expect(screen.queryByLabelText('More')).toBeNull();
    expect(screen.queryByLabelText('More ●')).toBeNull();
    expect(screen.queryByTestId('keypad-date')).toBeNull();
    expect(screen.queryByTestId('keypad-save')).toBeNull();
    expect(screen.queryByTestId('keypad-00')).toBeNull();
  });

  it('passes each digit, the decimal and the backspace to onDigit', async () => {
    const onDigit = jest.fn();
    await render(wrap(<Keypad onDigit={onDigit} />));
    await fireEvent.press(screen.getByTestId('keypad-7'));
    await fireEvent.press(screen.getByTestId('keypad-decimal'));
    await fireEvent.press(screen.getByTestId('keypad-backspace'));
    expect(onDigit.mock.calls).toEqual([['7'], [','], ['⌫']]);
  });

  it('compact keypad keeps its confirm cell and calls onSave with it', async () => {
    const onSave = jest.fn();
    await render(wrap(<Keypad compact saveLabel="Done" onSave={onSave} onDigit={jest.fn()} />));
    expect(screen.getByTestId('keypad-00')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('keypad-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
