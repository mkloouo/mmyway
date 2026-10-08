import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

afterEach(cleanup);

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: any) => children,
  Gesture: {
    Pan: () => {
      const pan: any = {
        activateAfterLongPress: () => pan,
        onStart: () => pan,
        onUpdate: () => pan,
        onEnd: () => pan,
        onFinalize: () => pan,
      };
      return pan;
    },
  },
}));
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: (c: any) => c,
    },
    createAnimatedComponent: (c: any) => c,
    useSharedValue: (init: any) => {
      const ref = require('react').useRef({ value: init });
      return ref.current;
    },
    useAnimatedStyle: (fn: any) => fn(),
    useEvent: () => jest.fn(),
    withTiming: (to: any) => to,
    runOnJS: (fn: any) => fn,
    Easing: {
      out: (f: any) => f,
      cubic: (f: any) => f,
    },
  };
});
import { DragList } from '../ui/DragList';

interface Item {
  id: string;
  name: string;
}

const items: Item[] = [
  { id: '1', name: 'Checking' },
  { id: '2', name: 'Savings' },
  { id: '3', name: 'Cash' },
];

function StatefulDragList({ onReorder }: { onReorder?: (items: Item[]) => void }) {
  const [list, setList] = useState(items);
  const handleMove = (from: number, to: number) => {
    const next = [...list];
    const [moved] = next.splice(from, 1);
    if (moved) next.splice(to, 0, moved);
    setList(next);
    onReorder?.(next);
  };
  return (
    <DragList
      items={list}
      keyOf={(i) => i.id}
      renderItem={(i) => <Text>{i.name}</Text>}
      onMove={handleMove}
      gap={8}
      moveLabels={{ up: 'Move up', down: 'Move down' }}
    />
  );
}

describe('DragList', () => {
  it('renders all items in initial order', async () => {
    const { unmount } = await render(
      <DragList
        items={items}
        keyOf={(i) => i.id}
        renderItem={(i) => <Text>{i.name}</Text>}
        onMove={jest.fn()}
        gap={8}
        moveLabels={{ up: 'Move up', down: 'Move down' }}
      />,
    );

    expect(screen.getByText('Checking')).toBeTruthy();
    expect(screen.getByText('Savings')).toBeTruthy();
    expect(screen.getByText('Cash')).toBeTruthy();
    await unmount();
  });

  it('reorders items via accessibility action in stateful list', async () => {
    const onReorder = jest.fn();
    const { getByText, unmount } = await render(<StatefulDragList onReorder={onReorder} />);

    // Savings is at index 1 -> move up to index 0
    await act(async () => {
      fireEvent(getByText('Savings'), 'accessibilityAction', {
        nativeEvent: { actionName: 'moveUp' },
      });
    });

    expect(onReorder).toHaveBeenCalledWith([
      { id: '2', name: 'Savings' },
      { id: '1', name: 'Checking' },
      { id: '3', name: 'Cash' },
    ]);

    expect(getByText('Savings')).toBeTruthy();
    expect(getByText('Checking')).toBeTruthy();
    expect(getByText('Cash')).toBeTruthy();
    await unmount();
  });
});
