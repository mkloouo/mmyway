import type { ReactNode } from 'react';
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme, hitSize } from '../theme';
import { PRESSED_OPACITY } from './rows';
import { Dot } from './feedback';

const CHIP_HEIGHT = 36;
const CHIP_SLOP = (hitSize - CHIP_HEIGHT) / 2;

export function Chip({
  label,
  selected,
  onPress,
  onLongPress,
  onRemove,
  tone,
  dotColor,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onRemove?: () => void;
  tone?: 'default' | 'warn';
  dotColor?: string;
  /** Required when `label` is a bare glyph rather than real text. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const border = tone === 'warn' ? t.color.warn : selected ? t.color.accent : t.color.border;
  const fill =
    tone === 'warn' ? t.color.warnSoft : selected ? t.color.accentSoft : t.color.surfaceAlt;
  const text = tone === 'warn' ? t.color.warn : selected ? t.color.accent : t.color.text;
  const handlePress = onRemove ?? onPress;
  return (
    <Pressable
      onPress={handlePress}
      onLongPress={onLongPress}
      // A chip is drawn 36 dp tall; the touch area reaches the kit's 44 above and below it.
      hitSlop={{ top: CHIP_SLOP, bottom: CHIP_SLOP }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.sm,
        minHeight: CHIP_HEIGHT,
        paddingHorizontal: t.space.md,
        paddingVertical: t.space.sm,
        borderRadius: t.radius.pill,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: fill,
        opacity: pressed ? PRESSED_OPACITY : 1,
      })}
    >
      {!!dotColor && <Dot color={dotColor} />}
      <Text style={[t.type.label, { color: text }]}>{label}</Text>
      {!!onRemove && <Ionicons name="close" size={14} color={text} style={{ marginLeft: 2 }} />}
    </Pressable>
  );
}

export function Button({
  title,
  hint,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  style,
  textStyle,
  accessibilityLabel,
  icon,
}: {
  title: string;
  /** A second line (12 px) saying what is missing when primary action is blocked (design §1). */
  hint?: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** `bar`: a text action in a top bar, the same height as a BarIconButton. */
  size?: 'bar' | 'md' | 'lg';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /** For a title that is an emoji or a glyph: what a screen reader should say instead. */
  accessibilityLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const t = useTheme();
  const fill =
    variant === 'primary'
      ? disabled
        ? t.color.accentDisabled
        : t.color.accent
      : variant === 'danger'
        ? t.color.dangerSoft
        : variant === 'secondary'
          ? t.color.surfaceAlt
          : 'transparent';
  const label =
    variant === 'primary'
      ? t.color.onAccent
      : variant === 'danger'
        ? t.color.danger
        : variant === 'ghost'
          ? t.color.accent
          : t.color.text;
  const a11y = accessibilityLabel ?? (hint ? `${title}, ${hint}` : title);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        {
          minHeight: size === 'lg' ? 52 : size === 'bar' ? 40 : hitSize,
          height: size === 'lg' ? 52 : undefined,
          paddingHorizontal: size === 'bar' ? t.space.lg : t.space.xl,
          borderRadius: t.radius.button,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: fill,
          opacity: disabled && variant !== 'primary' ? 0.4 : pressed ? PRESSED_OPACITY : 1,
        },
        style,
      ]}
    >
      {hint ? (
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {icon && <Ionicons name={icon} size={16} color={label} />}
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={[{ color: label, fontWeight: '700', fontSize: 15, lineHeight: 19 }, textStyle]}
            >
              {title.replace(/ /g, '\u00A0')}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={{
              color: label,
              fontSize: 12,
              lineHeight: 15,
              fontWeight: '500',
              opacity: 0.9,
            }}
          >
            {hint}
          </Text>
        </View>
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={label} />}
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={[
              size === 'lg' ? t.type.heading : t.type.body,
              { color: label, fontWeight: '700', flexShrink: 1 },
              textStyle,
            ]}
          >
            {title.replace(/ /g, '\u00A0')}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * The round floating button: the dock's two secondary actions. `accent`
 * is the filled one; the rest sit on the surface with a hairline border.
 */
export function Fab({
  icon,
  label,
  onPress,
  accent,
  size = 44,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  accent?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: accent ? t.color.accent : t.color.surface,
          borderWidth: accent ? 0 : 1,
          borderColor: t.color.border,
          opacity: pressed ? PRESSED_OPACITY : 1,
          elevation: 3,
        },
        style,
      ]}
    >
      <Ionicons
        name={icon}
        size={Math.round(size * 0.45)}
        color={accent ? t.color.onAccent : t.color.text}
      />
    </Pressable>
  );
}

/** A segmented control: one option is selected, the track sits on surfaceAlt. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: 'row',
        backgroundColor: t.color.surfaceAlt,
        borderRadius: t.radius.sm,
        padding: 2,
      }}
    >
      {options.map((o) => {
        const selected = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? t.color.surface : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: '600',
                color: selected ? t.color.text : t.color.textMuted,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** MODAL tier footer: one primary button (flex 2) beside Back (flex 1), pinned above the home indicator. */
export function StickyFooter({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: t.color.border,
        backgroundColor: t.color.bg,
        paddingTop: 12,
        paddingHorizontal: t.space.lg,
        paddingBottom: Math.max(insets.bottom, 12),
        flexDirection: 'row',
        gap: 10,
      }}
    >
      {children}
    </View>
  );
}
