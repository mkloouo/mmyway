import { fireEvent, render, screen } from '@testing-library/react-native';
import { TextField } from '../ui/TextField';

jest.setTimeout(15_000);

// A draft's title and notes are saved to SQLite and read back through a live query. Writing every
// keystroke put a database trip and a re-render of the screen behind each letter, so the field
// keeps its own text and hands it over once.
describe('TextField onCommit', () => {
  it('writes nothing while typing, and once on blur', async () => {
    const onCommit = jest.fn();
    await render(<TextField testID="f" value="a" onCommit={onCommit} />);
    const field = screen.getByTestId('f');
    await fireEvent(field, 'focus');
    await fireEvent.changeText(field, 'ab');
    await fireEvent.changeText(field, 'abc');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('f').props.value).toBe('abc');
    await fireEvent(field, 'blur');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('abc');
  });

  it('does not write an unchanged text, or the same text twice', async () => {
    const onCommit = jest.fn();
    const { unmount } = await render(<TextField testID="f" value="a" onCommit={onCommit} />);
    const field = screen.getByTestId('f');
    await fireEvent(field, 'focus');
    await fireEvent(field, 'blur');
    await fireEvent(field, 'focus');
    await fireEvent.changeText(field, 'b');
    await fireEvent(field, 'blur');
    await unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('b');
  });

  it('writes what is typed when it unmounts, as a sheet closing on Done does', async () => {
    const onCommit = jest.fn();
    const { unmount } = await render(<TextField testID="f" value="" onCommit={onCommit} />);
    await fireEvent(screen.getByTestId('f'), 'focus');
    await fireEvent.changeText(screen.getByTestId('f'), 'Groceries');
    await unmount();
    expect(onCommit).toHaveBeenCalledWith('Groceries');
  });

  it('commits to the latest callback, not the first render’s', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender, unmount } = await render(<TextField testID="f" value="" onCommit={first} />);
    await rerender(<TextField testID="f" value="" onCommit={second} />);
    await fireEvent.changeText(screen.getByTestId('f'), 'x');
    await unmount();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('x');
  });

  it('keeps what was typed while focused, ignoring a value coming in from outside', async () => {
    const { rerender } = await render(<TextField testID="f" value="a" onCommit={jest.fn()} />);
    await fireEvent(screen.getByTestId('f'), 'focus');
    await fireEvent.changeText(screen.getByTestId('f'), 'abc');
    await rerender(<TextField testID="f" value="ab" onCommit={jest.fn()} />);
    expect(screen.getByTestId('f').props.value).toBe('abc');
  });

  it('takes the value from outside when not being typed in', async () => {
    const { rerender } = await render(<TextField testID="f" value="a" onCommit={jest.fn()} />);
    await fireEvent(screen.getByTestId('f'), 'focus');
    await fireEvent(screen.getByTestId('f'), 'blur');
    await rerender(<TextField testID="f" value="changed elsewhere" onCommit={jest.fn()} />);
    expect(screen.getByTestId('f').props.value).toBe('changed elsewhere');
  });

  it('stays a plain controlled input without onCommit', async () => {
    const { rerender } = await render(<TextField testID="f" value="a" />);
    await fireEvent(screen.getByTestId('f'), 'focus');
    await fireEvent.changeText(screen.getByTestId('f'), 'ab');
    await rerender(<TextField testID="f" value="x" />);
    expect(screen.getByTestId('f').props.value).toBe('x');
  });
});
