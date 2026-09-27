// Swipe right to confirm, left to delete (design §6.1, §3.4). Runs the exact same call as the
// card's own button — the guard lives here, not in a second code path: an incomplete draft
// springs back instead of confirming.
import { useRef } from 'react';
import { Text, View } from 'react-native';
import Swipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useTheme } from './theme';

export function SwipeableCard({
  children, onConfirm, onDelete, confirmEnabled = true, onRefused,
}: {
  children: React.ReactNode;
  onConfirm?: () => void;
  onDelete?: () => void;
  /** false: a completed right-swipe springs back and calls onRefused instead of confirming. */
  confirmEnabled?: boolean;
  onRefused?: () => void;
}) {
  const t = useTheme();
  const ref = useRef<SwipeableMethods>(null);

  return (
    <Swipeable
      ref={ref}
      leftThreshold={64}
      rightThreshold={64}
      renderLeftActions={onConfirm ? () => (
        <View style={{ backgroundColor: t.color.accent, justifyContent: 'center', paddingHorizontal: t.space.xl }}>
          <Text style={{ color: t.color.onAccent, fontWeight: '700' }}>✓ Confirm</Text>
        </View>
      ) : undefined}
      renderRightActions={onDelete ? () => (
        <View style={{ backgroundColor: t.color.danger, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: t.space.xl }}>
          <Text style={{ color: t.color.onDanger, fontWeight: '700' }}>✕ Delete</Text>
        </View>
      ) : undefined}
      // `direction` is the way the row MOVED: a swipe to the right reveals the left actions
      // (✓ Confirm) and reports RIGHT. This used to test LEFT, so a right swipe ran Delete (only
      // its confirm dialog stopped it) and a left swipe tried to confirm.
      onSwipeableOpen={(direction) => {
        if (direction === SwipeDirection.RIGHT) {
          if (!confirmEnabled) {
            onRefused?.();
          } else {
            onConfirm?.();
          }
          ref.current?.close();
        } else {
          onDelete?.();
          ref.current?.close();
        }
      }}
    >
      {children}
    </Swipeable>
  );
}
