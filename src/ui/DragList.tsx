// Hold a row, then drag it to move it (Settings → Accounts → Reorder). The pan gesture only
// activates after a long press, so a short drag still scrolls the list, and until the finger has
// held, a row's own press keeps working.
//
// Rows are all one height, measured from the first one rather than passed in, so following the
// finger is arithmetic instead of measuring and caching every row: the row under it has moved
// round(draggedBy / rowHeight) places, and the rows it passed slide out of its way by one.
// ponytail: no auto-scroll while dragging at an edge — only the rows on screen can be reached.
// Add it if this list ever outgrows a screen or two.
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { haptics } from './haptics';

const HOLD_MS = 250;
const SETTLE_MS = 140;

/** The slot a row dragged `y` from `from` lands in. Runs on the UI thread and in the gesture. */
function landsAt(from: number, count: number, rowHeight: number, y: number): number {
  'worklet';
  if (rowHeight <= 0) return from;
  const to = from + Math.round(y / rowHeight);
  return to < 0 ? 0 : to > count - 1 ? count - 1 : to;
}

export function DragList<T>({
  items,
  keyOf,
  renderItem,
  onMove,
  gap,
  moveLabels,
  onDragChange,
}: {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** The row at `from` belongs at `to`; the caller holds the order and re-renders with it. */
  onMove: (from: number, to: number) => void;
  /**
   * True while a row is held. The surrounding scroll view has to stop scrolling for that — a
   * list that slides under the finger moves the row somewhere else than where it was dropped.
   */
  onDragChange?: (dragging: boolean) => void;
  /** Space between rows. Part of each row's measured height, so the arithmetic includes it. */
  gap: number;
  /** For TalkBack, which can't drag: each row's "move up" / "move down" actions. */
  moveLabels: { up: string; down: string };
}) {
  const [rowHeight, setRowHeight] = useState(0);
  // Which row is being dragged (-1: none) and how far. Shared by every row's animated style, and
  // written only here — a row asks for the change through begin/drag/commit, because the
  // react-hooks lint rules (rightly) don't let a component write to a shared value it was handed.
  const dragging = useSharedValue(-1);
  const dragY = useSharedValue(0);

  const begin = (index: number) => {
    'worklet';
    dragging.value = index;
    dragY.value = 0;
    if (onDragChange) runOnJS(onDragChange)(true);
  };
  const drag = (y: number) => {
    'worklet';
    dragY.value = y;
  };
  // The move first, then the reset, in one tick: resetting before the re-render that puts the row
  // in its new slot snaps it back to the old one for a frame. A cancelled drag commits from === to.
  const commit = (from: number, to: number) => {
    if (to !== from) onMove(from, to);
    dragging.value = -1;
    dragY.value = 0;
    onDragChange?.(false);
  };

  return (
    <View>
      {items.map((item, index) => (
        <DragRow
          key={keyOf(item)}
          index={index}
          count={items.length}
          rowHeight={rowHeight}
          onMeasure={index === 0 ? setRowHeight : undefined}
          dragging={dragging}
          dragY={dragY}
          begin={begin}
          drag={drag}
          commit={commit}
          gap={gap}
          labels={moveLabels}
        >
          {renderItem(item, index)}
        </DragRow>
      ))}
    </View>
  );
}

function DragRow({
  children,
  index,
  count,
  rowHeight,
  onMeasure,
  dragging,
  dragY,
  begin,
  drag,
  commit,
  gap,
  labels,
}: {
  children: ReactNode;
  index: number;
  count: number;
  rowHeight: number;
  onMeasure?: (height: number) => void;
  dragging: SharedValue<number>;
  dragY: SharedValue<number>;
  begin: (index: number) => void;
  drag: (y: number) => void;
  commit: (from: number, to: number) => void;
  gap: number;
  labels: { up: string; down: string };
}) {
  const pan = Gesture.Pan()
    .activateAfterLongPress(HOLD_MS)
    .onStart(() => {
      begin(index);
      runOnJS(haptics.tick)();
    })
    .onUpdate((e) => drag(e.translationY))
    .onEnd((e) => runOnJS(commit)(index, landsAt(index, count, rowHeight, e.translationY)))
    .onFinalize((_e, success) => {
      if (!success) runOnJS(commit)(index, index);
    });

  const style = useAnimatedStyle(() => {
    const from = dragging.value;
    if (from === index)
      return { transform: [{ translateY: dragY.value }, { scale: 1.03 }], zIndex: 2, opacity: 0.9 };
    const still = { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0, opacity: 1 };
    if (from < 0 || rowHeight <= 0) return still;
    const to = landsAt(from, count, rowHeight, dragY.value);
    const shift =
      from < to && index > from && index <= to
        ? -rowHeight
        : from > to && index >= to && index < from
          ? rowHeight
          : 0;
    if (shift === 0) return still;
    return {
      transform: [{ translateY: withTiming(shift, { duration: SETTLE_MS }) }, { scale: 1 }],
      zIndex: 0,
      opacity: 1,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[{ paddingBottom: gap }, style]}
        onLayout={onMeasure && ((e) => onMeasure(e.nativeEvent.layout.height))}
        accessibilityActions={[
          { name: 'moveUp', label: labels.up },
          { name: 'moveDown', label: labels.down },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'moveUp' && index > 0) commit(index, index - 1);
          if (e.nativeEvent.actionName === 'moveDown' && index < count - 1)
            commit(index, index + 1);
        }}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
