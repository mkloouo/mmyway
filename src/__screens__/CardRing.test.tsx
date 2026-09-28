import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import '../i18n';
import { Card } from '../ui/components';

describe('Card with a long-press ring', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('still taps and long-presses through the ring overlay', async () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    await render(<Card onPress={onPress} onLongPress={onLongPress} longPressRing delayLongPress={300}><Text>Revolut</Text></Card>);
    await fireEvent(screen.getByText('Revolut'), 'pressIn');
    await fireEvent(screen.getByText('Revolut'), 'longPress');
    await fireEvent(screen.getByText('Revolut'), 'pressOut');
    await act(async () => { jest.runAllTimers(); }); // let the ring animations finish inside act
    await fireEvent.press(screen.getByText('Revolut'));
    await act(async () => { jest.runAllTimers(); });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
