import { act as rtlAct, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { useAction } from './useAction';

let resolve: () => void;
const calls: number[] = [];

function Probe() {
  const act = useAction(() => {});
  const save = act('Save', async () => {
    calls.push(calls.length);
    await new Promise<void>((r) => {
      resolve = r;
    });
  });
  return (
    <Pressable testID="save" onPress={() => void save()}>
      <Text>{act.pending('Save') ? 'Saving' : 'Save'}</Text>
    </Pressable>
  );
}

describe('useAction', () => {
  it('drops a second tap while the first is still running, and reports pending', async () => {
    await render(<Probe />);
    expect(screen.getByText('Save')).toBeTruthy();

    await rtlAct(async () => {
      fireEvent.press(screen.getByTestId('save'));
    });
    expect(calls).toHaveLength(1);
    expect(screen.getByText('Saving')).toBeTruthy();

    // Tapped again mid-flight: ignored.
    await rtlAct(async () => {
      fireEvent.press(screen.getByTestId('save'));
    });
    expect(calls).toHaveLength(1);

    await rtlAct(async () => {
      resolve();
    });
    expect(screen.getByText('Save')).toBeTruthy();

    // Free again.
    await rtlAct(async () => {
      fireEvent.press(screen.getByTestId('save'));
    });
    expect(calls).toHaveLength(2);
  });
});
