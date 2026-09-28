// `Confirmed · Undo`, 5 s (design §6.1, §11 decision 2). Floats above the capture dock.
import { useEffect } from 'react';
import { Animated, Pressable, Text } from 'react-native';
import { usePopOnChange } from './feedback';
import { useTheme } from './theme';

const VISIBLE_MS = 5000;

export interface SnackbarEntry {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function Snackbar({ entry, onDismiss, bottom = 88 }: { entry: SnackbarEntry | null; onDismiss: () => void; bottom?: number }) {
  const t = useTheme();
  // Arrives with the tick haptic that caused it (a confirm, a delete): the pop is the visual half.
  const popStyle = usePopOnChange(entry?.id);

  useEffect(() => {
    if (!entry) return;
    const timer = setTimeout(onDismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [entry, onDismiss]);

  if (!entry) return null;

  return (
    <Animated.View
      style={[popStyle, {
        position: 'absolute', left: t.space.lg, right: t.space.lg, bottom,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: t.dark ? t.color.surfaceAlt : t.color.text,
        borderRadius: t.radius.md, paddingHorizontal: t.space.lg, paddingVertical: t.space.md,
        elevation: 8,
      }]}
    >
      <Text style={[t.type.body, { color: t.dark ? t.color.text : t.color.surface, flex: 1 }]} numberOfLines={1}>
        {entry.message}
      </Text>
      {!!entry.actionLabel && (
        <Pressable
          onPress={() => {
            entry.onAction?.();
            onDismiss();
          }}
          accessibilityRole="button"
        >
          <Text style={[t.type.label, { color: t.color.accent, fontWeight: '700', paddingLeft: t.space.lg }]}>
            {entry.actionLabel}
          </Text>
        </Pressable>
      )}
    </Animated.View>
  );
}
