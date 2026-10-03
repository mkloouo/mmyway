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
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { haptics } from './haptics';

const HOLD_MS = 250;
/** Picking a row up and putting it back down. */
const LIFT_MS = 120;
/** The dropped row travelling into its new slot, and a row sliding out of its way. */
const SETTLE_MS = 170;
const SHIFT_MS = 150;
const LIFT_SCALE = 0.04;
const EASE = { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) };

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
  // Which row is being dragged (-1: none), how far, and how far off the list it is held. Shared by
  // every row's animated style, and written only here — a row asks for the change through
  // begin/drag/release, because the react-hooks lint rules (rightly) don't let a component write
  // to a shared value it was handed.
  const dragging = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const lift = useSharedValue(0);

  // Changes the order, and only then puts everything back to rest: by now the dropped row has
  // already travelled into its new slot and the rows it passed are holding the gap open, so the
  // re-render that reorders them lands each one exactly where it already is on screen. Resetting
  // any earlier is the snap this list used to end every drag with.
  const commit = (from: number, to: number) => {
    if (to !== from) onMove(from, to);
    dragging.value = -1;
    dragY.value = 0;
    lift.value = 0;
    onDragChange?.(false);
  };

  const begin = (index: number) => {
    'worklet';
    dragging.value = index;
    dragY.value = 0;
    lift.value = withTiming(1, { duration: LIFT_MS });
    if (onDragChange) runOnJS(onDragChange)(true);
  };

  const drag = (y: number) => {
    'worklet';
    dragY.value = y;
  };

  /** The finger lifts: the row settles into `slot` (its offset from where it started) and lands. */
  const release = (from: number, to: number, slot: number) => {
    'worklet';
    lift.value = withTiming(0, { duration: LIFT_MS });
    // Timing, not a spring: an overshoot would carry the row past its slot, and every other row
    // reads the same value to decide where to hold the gap — they would all twitch with it.
    dragY.value = withTiming(slot, EASE, () => runOnJS(commit)(from, to));
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
          lift={lift}
          begin={begin}
          drag={drag}
          release={release}
          move={commit}
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
  lift,
  begin,
  drag,
  release,
  move,
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
  lift: SharedValue<number>;
  begin: (index: number) => void;
  drag: (y: number) => void;
  release: (from: number, to: number, slot: number) => void;
  /** Straight to the new order, for TalkBack's move actions — nothing to animate from. */
  move: (from: number, to: number) => void;
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
    .onEnd((e) => {
      const to = landsAt(index, count, rowHeight, e.translationY);
      release(index, to, (to - index) * rowHeight);
    })
    // A cancelled drag travels home the same way instead of blinking back.
    .onFinalize((_e, success) => {
      if (!success) release(index, index, 0);
    });

  const style = useAnimatedStyle(() => {
    const from = dragging.value;
    if (from === index)
      return {
        transform: [{ translateY: dragY.value }, { scale: 1 + LIFT_SCALE * lift.value }],
        zIndex: 2,
      };
    const atRest = { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0 };
    // Nothing held: the commit has just reordered the list, so every row is already where it
    // belongs — animating back to 0 from here would undo the move it just made visible.
    if (from < 0 || rowHeight <= 0) return atRest;
    const to = landsAt(from, count, rowHeight, dragY.value);
    const shift =
      from < to && index > from && index <= to
        ? -rowHeight
        : from > to && index >= to && index < from
          ? rowHeight
          : 0;
    return {
      transform: [{ translateY: withTiming(shift, { duration: SHIFT_MS }) }, { scale: 1 }],
      zIndex: 0,
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
          if (e.nativeEvent.actionName === 'moveUp' && index > 0) move(index, index - 1);
          if (e.nativeEvent.actionName === 'moveDown' && index < count - 1) move(index, index + 1);
        }}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
