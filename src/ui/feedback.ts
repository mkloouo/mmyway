// Visual twins of src/ui/haptics.ts (design §3.4): every place that buzzes also moves, so the
// feedback isn't lost on a phone without a vibration motor (or with haptics switched off).
//   warn    -> useShake: a short side-to-side shake of what refused
//   tick    -> usePop:   a quick grow-and-settle of what changed
//   key     -> Keypad's key shrinks under the finger
//   success -> usePop on the sync pill
//   hold    -> usePop on the card when its long press fires (Card's longPressPop)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

export function useShake() {
  const [x] = useState(() => new Animated.Value(0));
  const shake = useCallback(() => {
    x.stopAnimation();
    x.setValue(0);
    Animated.sequence(
      [-8, 8, -6, 6, -3, 0].map((toValue) =>
        Animated.timing(x, { toValue, duration: 45, useNativeDriver: true }),
      ),
    ).start();
  }, [x]);
  return { shake, shakeStyle: { transform: [{ translateX: x }] } };
}

export function usePop(scaleTo = 1.06) {
  const [scale] = useState(() => new Animated.Value(1));
  const pop = useCallback(() => {
    scale.stopAnimation();
    scale.setValue(1);
    Animated.sequence([
      Animated.timing(scale, { toValue: scaleTo, duration: 90, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  }, [scale, scaleTo]);
  return { pop, popStyle: { transform: [{ scale }] } };
}

/** Pops whenever `value` changes after the first render (a card becoming selected, a new snackbar). */
export function usePopOnChange(value: unknown, scaleTo?: number) {
  const { pop, popStyle } = usePop(scaleTo);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pop();
  }, [value, pop]);
  return popStyle;
}

/**
 * Capture's save: the amount just saved floats up and fades out while the cleared field fades in
 * (about 0.65 s), slow enough to see — the instant jump to 0 read as nothing happening. `fly`
 * takes the text as it was on screen; render `ghost` over the field with `ghostStyle`, and give
 * the field itself `fieldStyle`.
 */
export function useFlyAway() {
  const [ghost, setGhost] = useState<{ key: number; text: string } | null>(null);
  const [out] = useState(() => new Animated.Value(1));
  const [inField] = useState(() => new Animated.Value(1));
  const fly = useCallback(
    (text: string) => {
      setGhost({ key: Date.now(), text });
      out.stopAnimation();
      inField.stopAnimation();
      out.setValue(0);
      inField.setValue(0);
      Animated.parallel([
        Animated.timing(out, {
          toValue: 1,
          duration: 650,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(inField, { toValue: 1, duration: 350, delay: 250, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setGhost(null);
      });
    },
    [out, inField],
  );
  // Built once: interpolate() makes a new animated node each call, and Capture re-renders on every key.
  const ghostStyle = useMemo(
    () => ({
      opacity: out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      transform: [
        { translateY: out.interpolate({ inputRange: [0, 1], outputRange: [0, -48] }) },
        { scale: out.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] }) },
      ],
    }),
    [out],
  );
  return { fly, ghost, ghostStyle, fieldStyle: { opacity: inField } };
}
