// Hold a row, then drag it to move it (Settings → Accounts → Reorder). The pan gesture only
// activates after a long press, so a short drag still scrolls the list, and until the finger has
// held, a row's own press keeps working.
//
// Every row measures itself, because rows are not all one height: an account with an "Envelope"
// or "Inactive" chip is taller than a plain one. Measuring the first row and multiplying (what
// this did) made the rows a drag passed slide by the wrong amount, overlapping the row above.
// src/ui/dragSlots.ts turns those heights into where a drag lands and how far it travelled.
// ponytail: no auto-scroll while dragging at an edge — only the rows on screen can be reached.
// Add it if this list ever outgrows a screen or two.
import { useRef, type ReactNode } from 'react';
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
import { landsAt, slotOf } from './dragSlots';
import { haptics } from './haptics';

const HOLD_MS = 250;
/** Picking a row up and putting it back down. */
const LIFT_MS = 120;
/** The dropped row travelling into its new slot, and a row sliding out of its way. */
const SETTLE_MS = 170;
const SHIFT_MS = 150;
const LIFT_SCALE = 0.04;
const EASE = { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) };

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
  // Each row's height, in the order the rows are in — read by the gesture and by every row's
  // animated style. Kept by key, because a reorder keeps the heights and only moves them about;
  // the whole list is published on every row layout, which is also how the new order gets in: a
  // reorder moves rows, every row it moved reports its layout, and `items` is the new order by then.
  const measured = useRef(new Map<string, number>());
  const heights = useSharedValue<number[]>([]);
  const measure = (key: string, height: number) => {
    measured.current.set(key, height);
    heights.value = items.map((item) => measured.current.get(keyOf(item)) ?? 0);
  };

  // Which row is being dragged (-1: none) and how far, and how far off the list it is held.
  // Shared by every row's animated style, and written only here — a row asks for the change
  // through begin/drag/release, because the react-hooks lint rules (rightly) don't let a
  // component write to a shared value it was handed.
  const dragging = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const lift = useSharedValue(0);

  // Track the actual order of item keys so that re-renders with the same items in the same order
  // (such as when the parent toggles scrollEnabled on drag start) do not cancel an in-progress drag.
  // When React commits a new key order, reset drag transforms synchronously in render so rows land
  // seamlessly in their native positions with zero flicker or single-frame blink.
  const currentKeyOrder = items.map(keyOf).join(',');
  const prevKeyOrderRef = useRef(currentKeyOrder);
  // eslint-disable-next-line react-hooks/refs
  if (prevKeyOrderRef.current !== currentKeyOrder) {
    // eslint-disable-next-line react-hooks/refs
    prevKeyOrderRef.current = currentKeyOrder;
    dragging.value = -1;
    dragY.value = 0;
    lift.value = 0;
  }

  // Changes the order and keeps heights aligned with the new order. The drag values are left
  // holding the row in its settled slot until React renders the new items order above, so the
  // transition between animated transforms and native view layout is completely seamless.
  const commit = (from: number, to: number) => {
    if (to !== from) {
      const nextHeights = [...heights.value];
      const [movedHeight] = nextHeights.splice(from, 1);
      if (movedHeight !== undefined) {
        nextHeights.splice(to, 0, movedHeight);
        heights.value = nextHeights;
      }
      onMove(from, to);
    } else {
      dragging.value = -1;
      dragY.value = 0;
      lift.value = 0;
    }
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
      {items.map((item, index) => {
        const key = keyOf(item);
        return (
          <DragRow
            key={key}
            index={index}
            heights={heights}
            onMeasure={(height) => measure(key, height)}
            dragging={dragging}
            dragY={dragY}
            lift={lift}
            begin={begin}
            drag={drag}
            release={release}
            move={commit}
            count={items.length}
            gap={gap}
            labels={moveLabels}
          >
            {renderItem(item, index)}
          </DragRow>
        );
      })}
    </View>
  );
}

function DragRow({
  children,
  index,
  count,
  heights,
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
  heights: SharedValue<number[]>;
  onMeasure: (height: number) => void;
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
  const currentIndex = useSharedValue(index);
  currentIndex.value = index;

  const pan = Gesture.Pan()
    .activateAfterLongPress(HOLD_MS)
    .onStart(() => {
      begin(currentIndex.value);
      runOnJS(haptics.tick)();
    })
    .onUpdate((e) => drag(e.translationY))
    .onEnd((e) => {
      const from = currentIndex.value;
      const to = landsAt(from, heights.value, e.translationY);
      release(from, to, slotOf(from, to, heights.value));
    })
    // A cancelled drag travels home the same way instead of blinking back.
    .onFinalize((_e, success) => {
      if (!success) {
        const from = currentIndex.value;
        release(from, from, 0);
      }
    });

  const style = useAnimatedStyle(() => {
    const from = dragging.value;
    const myIndex = currentIndex.value;
    if (from === myIndex)
      return {
        transform: [{ translateY: dragY.value }, { scale: 1 + LIFT_SCALE * lift.value }],
        zIndex: 2,
        elevation: 4,
      };
    const atRest = { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0, elevation: 0 };
    // Nothing held: the commit has just reordered the list, so every row is already where it
    // belongs — animating back to 0 from here would undo the move it just made visible.
    if (from < 0 || heights.value.length === 0) return atRest;
    const to = landsAt(from, heights.value, dragY.value);
    // A row slides out of the way by the height of the row being dragged over it, not its own.
    const held = heights.value[from] ?? 0;
    const shift =
      from < to && myIndex > from && myIndex <= to
        ? -held
        : from > to && myIndex >= to && myIndex < from
          ? held
          : 0;
    return {
      transform: [{ translateY: withTiming(shift, { duration: SHIFT_MS }) }, { scale: 1 }],
      zIndex: 0,
      elevation: 0,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[{ paddingBottom: gap }, style]}
        onLayout={(e) => onMeasure(e.nativeEvent.layout.height)}
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
