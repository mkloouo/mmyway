// `Confirmed · Undo`, 5 s (design §6.1, §11 decision 2). Floats above the capture dock.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text } from 'react-native';
import { usePopOnChange } from './feedback';
import { useTheme } from './theme';

const VISIBLE_MS = 5000;
const LEAVE_MS = 200;

export interface SnackbarEntry {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function Snackbar({
  entry,
  onDismiss,
  bottom = 88,
}: {
  entry: SnackbarEntry | null;
  onDismiss: () => void;
  bottom?: number;
}) {
  const t = useTheme();
  // Arrives with the tick haptic that caused it (a confirm, a delete): the pop is the visual half.
  const popStyle = usePopOnChange(entry?.id);
  // The pop was the arrival with no departure to match: whether the five seconds ran out or Undo
  // was tapped, the bar vanished between two frames. The entry the caller has already dropped is
  // kept here until it has faded, so the one thing in the app that animated in but not out now
  // does both. `faded` is the id that finished leaving — the only state, and it is set from the
  // animation's own callback rather than from an effect.
  const [fade] = useState(() => new Animated.Value(1));
  const [kept, setKept] = useState<SnackbarEntry | null>(entry);
  // Adjusting state to a changed prop, during render rather than in an effect: React re-renders
  // straight away without painting the in-between (react.dev, "You Might Not Need an Effect").
  if (entry && entry !== kept) setKept(entry);
  const shown = entry ?? kept;

  // The timer runs per entry, not per render: with `onDismiss` as a dependency, a caller passing an
  // inline arrow restarted it on every re-render, and the Undo outlived the window it promises.
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  useEffect(() => {
    if (!entry) return;
    const timer = setTimeout(() => dismiss.current(), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [entry]);

  useEffect(() => {
    if (entry) {
      fade.stopAnimation();
      fade.setValue(1);
      return;
    }
    if (!kept) return;
    Animated.timing(fade, {
      toValue: 0,
      duration: LEAVE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setKept(null);
    });
  }, [entry, kept, fade]);

  if (!shown) return null;

  // The outer view holds the position and the fade; the pop is a transform on the inner one, so
  // the two animations never write the same style.
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: t.space.lg,
        right: t.space.lg,
        bottom,
        opacity: fade,
      }}
      // Gone as far as a screen reader and a finger are concerned the moment it starts leaving.
      pointerEvents={entry ? 'auto' : 'none'}
      accessibilityElementsHidden={!entry}
      importantForAccessibility={entry ? 'auto' : 'no-hide-descendants'}
    >
      <Animated.View
        style={[
          popStyle,
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: t.dark ? t.color.surfaceAlt : t.color.text,
            borderRadius: t.radius.md,
            paddingHorizontal: t.space.lg,
            paddingVertical: t.space.md,
            elevation: 8,
          },
        ]}
      >
        <Text
          style={[t.type.body, { color: t.dark ? t.color.text : t.color.surface, flex: 1 }]}
          numberOfLines={1}
        >
          {shown.message}
        </Text>
        {!!shown.actionLabel && (
          <Pressable
            onPress={() => {
              shown.onAction?.();
              onDismiss();
            }}
            accessibilityRole="button"
          >
            <Text
              style={[
                t.type.label,
                { color: t.color.accent, fontWeight: '700', paddingLeft: t.space.lg },
              ]}
            >
              {shown.actionLabel}
            </Text>
          </Pressable>
        )}
      </Animated.View>
    </Animated.View>
  );
}
