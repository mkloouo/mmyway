import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import '../i18n';
import { Card } from '../ui/components';

describe('Card with a long-press pop', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('still taps and long-presses through the pop wrapper', async () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    await render(
      <Card onPress={onPress} onLongPress={onLongPress} longPressPop delayLongPress={300}>
        <Text>Revolut</Text>
      </Card>,
    );
    await fireEvent(screen.getByText('Revolut'), 'pressIn');
    await fireEvent(screen.getByText('Revolut'), 'longPress');
    await fireEvent(screen.getByText('Revolut'), 'pressOut');
    await act(async () => {
      jest.runAllTimers();
    }); // let the pop animation finish inside act
    await fireEvent.press(screen.getByText('Revolut'));
    await act(async () => {
      jest.runAllTimers();
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
