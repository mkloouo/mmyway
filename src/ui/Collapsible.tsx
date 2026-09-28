// A list row that leaves smoothly (design §3.4 motion): when `collapsed` turns on it fades and
// shrinks its own height to zero, so the rows below slide up instead of jumping. Screens set it
// first and remove the row from the data after COLLAPSE_MS (leaveThen below).
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';

export const COLLAPSE_MS = 260;

export function Collapsible({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  const [anim] = useState(() => new Animated.Value(1));
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!collapsed) {
      anim.stopAnimation();
      anim.setValue(1);
      return;
    }
    // Height can't run on the native driver.
    Animated.timing(anim, { toValue: 0, duration: COLLAPSE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [collapsed, anim]);

  return (
    <Animated.View
      onLayout={collapsed ? undefined : (e) => setHeight(e.nativeEvent.layout.height)}
      style={collapsed && height !== null
        ? { height: anim.interpolate({ inputRange: [0, 1], outputRange: [0, height] }), opacity: anim, overflow: 'hidden' }
        : { opacity: anim }}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Marks rows as leaving, runs `then` once they've collapsed, and forgets them a little later
 * (by then the data no longer has them; if it still does — an undo, a failed write — they show
 * again).
 */
export function leaveThen(
  ids: string[],
  setLeaving: (update: (cur: Set<string>) => Set<string>) => void,
  then: () => void | Promise<void>,
): void {
  setLeaving((cur) => new Set([...cur, ...ids]));
  setTimeout(() => {
    void Promise.resolve(then()).finally(() => {
      setTimeout(() => setLeaving((cur) => new Set([...cur].filter((id) => !ids.includes(id)))), 1500);
    });
  }, COLLAPSE_MS);
}
