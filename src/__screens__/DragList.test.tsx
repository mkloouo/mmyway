import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { DragList } from '../ui/DragList';

afterEach(cleanup);

const panHandlers: {
  onStart?: () => void;
  onUpdate?: (e: { translationY: number }) => void;
  onEnd?: (e: { translationY: number }) => void;
  onFinalize?: (e: any, success: boolean) => void;
}[] = [];

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: any) => children,
  Gesture: {
    Pan: () => {
      const handlers: {
        onStart?: () => void;
        onUpdate?: (e: { translationY: number }) => void;
        onEnd?: (e: { translationY: number }) => void;
        onFinalize?: (e: any, success: boolean) => void;
      } = {};
      panHandlers.push(handlers);
      const pan: any = {
        activateAfterLongPress: () => pan,
        onStart: (fn: any) => {
          handlers.onStart = fn;
          return pan;
        },
        onUpdate: (fn: any) => {
          handlers.onUpdate = fn;
          return pan;
        },
        onEnd: (fn: any) => {
          handlers.onEnd = fn;
          return pan;
        },
        onFinalize: (fn: any) => {
          handlers.onFinalize = fn;
          return pan;
        },
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
    withTiming: (to: any, _config?: any, cb?: any) => {
      if (typeof cb === 'function') cb(true);
      return to;
    },
    runOnJS: (fn: any) => fn,
    Easing: {
      out: (f: any) => f,
      cubic: (f: any) => f,
    },
  };
});

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

  it('preserves active drag across re-renders with identical key order', async () => {
    panHandlers.length = 0;
    const onDragChange = jest.fn();
    const onMove = jest.fn();

    const { getByText, rerender, unmount } = await render(
      <DragList
        items={items}
        keyOf={(i) => i.id}
        renderItem={(i) => <Text>{i.name}</Text>}
        onMove={onMove}
        onDragChange={onDragChange}
        gap={8}
        moveLabels={{ up: 'Move up', down: 'Move down' }}
      />,
    );

    // Measure rows so heights.value is populated
    fireEvent(getByText('Checking'), 'layout', { nativeEvent: { layout: { height: 50 } } });
    fireEvent(getByText('Savings'), 'layout', { nativeEvent: { layout: { height: 50 } } });
    fireEvent(getByText('Cash'), 'layout', { nativeEvent: { layout: { height: 50 } } });

    expect(panHandlers.length).toBe(3);

    // Start dragging first item
    panHandlers[0]?.onStart?.();

    expect(onDragChange).toHaveBeenCalledWith(true);

    // Parent re-renders with a brand-new array reference but identical keys (e.g. holding changed)
    rerender(
      <DragList
        items={[...items]}
        keyOf={(i) => i.id}
        renderItem={(i) => <Text>{i.name}</Text>}
        onMove={onMove}
        onDragChange={onDragChange}
        gap={8}
        moveLabels={{ up: 'Move up', down: 'Move down' }}
      />,
    );

    // onDragChange should not have been called with false (drag must not abort)
    expect(onDragChange).not.toHaveBeenCalledWith(false);

    // Release drag
    panHandlers[0]?.onEnd?.({ translationY: 80 });

    expect(onMove).toHaveBeenCalled();
    expect(onDragChange).toHaveBeenCalledWith(false);

    await unmount();
  });
});
