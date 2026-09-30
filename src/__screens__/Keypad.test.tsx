// Capture's keypad (src/ui/Keypad.tsx): the More key and the date key.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { Keypad } from '../ui/Keypad';

jest.setTimeout(15_000);

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function keypad(props: { dateLabel?: string; dateCompact?: boolean; moreHasValue?: boolean }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <Keypad
        onDigit={jest.fn()}
        dateLabel={props.dateLabel ?? 'Today ▾'}
        dateCompact={props.dateCompact}
        onDatePress={jest.fn()}
        onMorePress={onMore}
        moreHasValue={props.moreHasValue}
        saveLabel="Save & ✓"
        onSave={jest.fn()}
      />
    </SafeAreaProvider>
  );
}
const onMore = jest.fn();

function fontSizeOf(label: string): number | undefined {
  const text = screen.getByText(label);
  return StyleSheet.flatten(text.props.style).fontSize;
}

describe('Keypad', () => {
  beforeEach(() => onMore.mockClear());

  it('calls the fourth-row key More, not Note, and opens the rest of the fields with it', async () => {
    await render(keypad({}));
    expect(screen.queryByText('Note')).toBeNull();
    await fireEvent.press(screen.getByLabelText('More'));
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it('marks More with a dot when something under it is set', async () => {
    await render(keypad({ moreHasValue: true }));
    expect(screen.getByLabelText('More ●')).toBeTruthy();
  });

  it('draws a picked date in a much smaller font than a key label', async () => {
    await render(keypad({ dateLabel: '9/25, 12:23 PM', dateCompact: true }));
    const date = fontSizeOf('9/25, 12:23 PM');
    const digit = fontSizeOf('1');
    expect(digit).toBeGreaterThanOrEqual(17);
    expect(date).toBeLessThanOrEqual(12);
  });

  it('keeps the normal size for Today and Yesterday', async () => {
    await render(keypad({ dateLabel: 'Today ▾' }));
    expect(fontSizeOf('Today ▾')).toBe(fontSizeOf('1'));
  });
});
