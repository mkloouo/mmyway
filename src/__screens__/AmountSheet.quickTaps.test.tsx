// Two digits typed before React re-renders (two taps inside one frame) must both count. The Keypad
// is replaced by a stub so the test can call the sheet's onDigit twice inside one act(), which is
// the situation the draft screen used to lose the first digit in.
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { AmountSheet } from '../ui/AmountSheet';
import type { KeypadKey } from '../capture/amountInput';

jest.setTimeout(15_000);

let keypad: { onDigit: (key: KeypadKey) => void; onSave: () => void };
jest.mock('../ui/Keypad', () => ({
  Keypad: (props: typeof keypad) => {
    keypad = props;
    return null;
  },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

it('applies both digits, each on what the last one typed', async () => {
  const onDone = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <AmountSheet
        visible
        title="Amount"
        initial="0"
        currency={{ symbol: 'zł', decimalPlaces: 2 }}
        type="withdrawal"
        onDone={onDone}
      />
    </SafeAreaProvider>,
  );
  await act(async () => {
    keypad.onDigit('1');
    keypad.onDigit('2');
  });
  await act(async () => keypad.onSave());
  expect(onDone).toHaveBeenCalledWith('12');
});
