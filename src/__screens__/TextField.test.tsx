import { fireEvent, render, screen } from '@testing-library/react-native';
import { TextField } from '../ui/TextField';

// A draft's note is saved to SQLite and read back: each keystroke's value comes back as a prop a
// moment later, so the field sees older text arrive while the user is still typing.
describe('TextField buffered', () => {
  it('keeps what was typed while focused, ignoring a stale value coming back', async () => {
    const onChangeText = jest.fn();
    const { rerender } = await render(<TextField testID="f" buffered value="a" onChangeText={onChangeText} />);
    const field = screen.getByTestId('f');
    await fireEvent(field, 'focus');
    await fireEvent.changeText(field, 'ab');
    await fireEvent.changeText(field, 'abc');
    expect(onChangeText).toHaveBeenLastCalledWith('abc');
    await rerender(<TextField testID="f" buffered value="ab" onChangeText={onChangeText} />);
    expect(screen.getByTestId('f').props.value).toBe('abc');
  });

  it('takes the value from outside when not being typed in', async () => {
    const { rerender } = await render(<TextField testID="f" buffered value="a" />);
    await fireEvent(screen.getByTestId('f'), 'focus');
    await fireEvent(screen.getByTestId('f'), 'blur');
    await rerender(<TextField testID="f" buffered value="changed elsewhere" />);
    expect(screen.getByTestId('f').props.value).toBe('changed elsewhere');
  });

  it('stays a plain controlled input without buffered', async () => {
    const { rerender } = await render(<TextField testID="f" value="a" />);
    await fireEvent(screen.getByTestId('f'), 'focus');
    await fireEvent.changeText(screen.getByTestId('f'), 'ab');
    await rerender(<TextField testID="f" value="x" />);
    expect(screen.getByTestId('f').props.value).toBe('x');
  });
});
