// The iOS picker sheet (src/ui/PickerHost.tsx) that answers pickTime / pickDate on iOS.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { PickerHost } from '../ui/PickerHost';
import { pickTime } from '../ui/pickDate';

jest.setTimeout(15_000);

const mockPicker = jest.fn((_props: Record<string, unknown>) => null);
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => mockPicker(props),
  DateTimePickerAndroid: { open: jest.fn() },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function wrap(node: React.ReactElement) {
  return <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>;
}

describe('PickerHost on iOS', () => {
  let platform: { restore: () => void };

  beforeEach(() => {
    platform = jest.replaceProperty(Platform, 'OS', 'ios');
    mockPicker.mockClear();
  });

  afterEach(() => {
    platform.restore();
  });

  it('opens a time spinner for pickTime, and Done answers with the chosen HH:MM', async () => {
    const onPick = jest.fn();
    await render(wrap(<PickerHost />));
    await act(async () => {
      pickTime('09:30', onPick);
    });
    expect(mockPicker).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'time', display: 'spinner' }),
    );
    await fireEvent.press(screen.getByText('Done'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('09:30');
  });

  it('cancelling the sheet answers nothing', async () => {
    const onPick = jest.fn();
    await render(wrap(<PickerHost />));
    await act(async () => {
      pickTime('09:30', onPick);
    });
    // The first "Close" is the scrim, which cancels the same way the ✕ does.
    await fireEvent.press(screen.getAllByLabelText('Close')[0]!);
    expect(onPick).not.toHaveBeenCalled();
  });
});
