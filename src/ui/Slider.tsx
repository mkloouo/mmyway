// A plain horizontal slider (no native dependency): a track, a filled part and a thumb, dragged or
// tapped anywhere along the track. Reports a position 0..1; what that means in money is the
// caller's (src/splits/allocate.ts's positionToMinor).
import { useState } from 'react';
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { useTheme } from './theme';

const THUMB = 24;

export function Slider({
  value,
  onChange,
  disabled,
  accessibilityLabel,
}: {
  value: number;
  onChange: (position: number) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);

  // React Native's responder props, not a PanResponder: plain callbacks that read this render's
  // width and onChange, so nothing has to be kept in refs.
  const report = (x: number) => {
    const w = width - THUMB;
    if (w <= 0) return;
    onChange(Math.min(1, Math.max(0, (x - THUMB / 2) / w)));
  };
  const handlers = {
    onStartShouldSetResponder: () => !disabled,
    onMoveShouldSetResponder: () => !disabled,
    // The pager around a split must not steal a horizontal drag that started on a slider.
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => report(e.nativeEvent.locationX),
    onResponderMove: (e: GestureResponderEvent) => report(e.nativeEvent.locationX),
  };

  const clamped = Math.min(1, Math.max(0, value));
  const left = Math.max(0, (width - THUMB) * clamped);
  return (
    <View
      {...handlers}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) =>
        onChange(
          Math.min(
            1,
            Math.max(0, clamped + (e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05)),
          ),
        )
      }
      style={{ height: THUMB + 12, justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
    >
      <View
        pointerEvents="none"
        style={{ height: 4, borderRadius: 2, backgroundColor: t.color.surfaceAlt }}
      >
        <View
          style={{
            width: left + THUMB / 2,
            height: 4,
            borderRadius: 2,
            backgroundColor: t.color.accent,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left,
          width: THUMB,
          height: THUMB,
          borderRadius: THUMB / 2,
          backgroundColor: t.color.surface,
          borderWidth: 2,
          borderColor: t.color.accent,
        }}
      />
    </View>
  );
}
