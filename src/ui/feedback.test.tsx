import { act, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { usePopOnChange } from './feedback';

function Probe({ value }: { value: unknown }) {
  const style = usePopOnChange(value);
  return <Animated.View testID="probe" style={style} />;
}

describe('usePopOnChange', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stays still on the first render and pops when the value changes', async () => {
    const spy = jest.spyOn(Animated, 'sequence');
    const { rerender } = await render(<Probe value={false} />);
    expect(spy).not.toHaveBeenCalled();
    await rerender(<Probe value />);
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { jest.runAllTimers(); });
    spy.mockRestore();
  });
});
