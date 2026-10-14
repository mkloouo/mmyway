import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Switch,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** Every row in a Card is at least this tall (kit board 1). */
export const ROW_HEIGHT = 52;

/** How far a pressable dims under the finger. One value, so every surface agrees. */
export const PRESSED_OPACITY = 0.6;

/** `style={({ pressed }) => pressedStyle(pressed)}` on a bare Pressable. */
export function pressedStyle(pressed: boolean, style?: ViewStyle): ViewStyle {
  return { ...style, opacity: pressed ? PRESSED_OPACITY : 1 };
}

export type TileTone = 'accent' | 'warn' | 'income' | 'danger' | 'muted';

/** A rounded square holding an icon: the leading mark of a row or a PUSH header. */
export function Tile({
  icon,
  tone = 'accent',
  size = 28,
  iconSize,
}: {
  icon: IconName;
  tone?: TileTone;
  size?: number;
  iconSize?: number;
}) {
  const t = useTheme();
  const { bg, fg } = tileColors(t, tone);
  return (
    <View
      style={{
        width: size,
        height: size,
        // 8 at 28, 14 at 52: one ratio, so the corner scales with the tile.
        borderRadius: Math.round(size * 0.27),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
      }}
    >
      <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.57)} color={fg} />
    </View>
  );
}

function tileColors(t: ReturnType<typeof useTheme>, tone: TileTone): { bg: string; fg: string } {
  switch (tone) {
    case 'warn':
      return { bg: t.color.warnSoft, fg: t.color.warn };
    case 'income':
      return { bg: t.color.surfaceAlt, fg: t.color.income };
    case 'danger':
      return { bg: t.color.dangerSoft, fg: t.color.danger };
    case 'muted':
      return { bg: t.color.surfaceAlt, fg: t.color.textMuted };
    case 'accent':
      return { bg: t.color.accentSoft, fg: t.color.accent };
  }
}

/**
 * A row inside a `<Card flush>` group. The hairline above it starts after the leading tile, or at
 * the row's own inset when there is none. `first` drops the hairline.
 */
export function ListRow({
  label,
  sub,
  leading,
  trailing,
  chevron,
  onPress,
  onLongPress,
  first,
  tone,
}: {
  label: string;
  sub?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  first?: boolean;
  tone?: 'default' | 'danger';
}) {
  const t = useTheme();
  const interactive = !!onPress || !!onLongPress;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      pressRetentionOffset={interactive ? { top: 60, bottom: 60, left: 30, right: 30 } : undefined}
      style={({ pressed }) => ({
        minHeight: ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        opacity: pressed ? PRESSED_OPACITY : 1,
      })}
    >
      {!first && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            left: leading ? 56 : 16,
            height: 1,
            backgroundColor: t.color.border,
          }}
        />
      )}
      {leading}
      <View style={{ flex: 1 }}>
        <Text style={[t.type.body, { color: tone === 'danger' ? t.color.danger : t.color.text }]}>
          {label}
        </Text>
        {!!sub && (
          <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {trailing}
      {chevron && <Ionicons name="chevron-forward" size={16} color={t.color.textFaint} />}
    </Pressable>
  );
}

/**
 * A labelled switch with an optional hint line, a row in a Card (kit board 1). Tapping anywhere on
 * the row toggles it: the Switch is drawn with `pointerEvents="none"`, so the row's press is the
 * only handler and a tap can't toggle twice.
 */
export function SwitchRow({
  label,
  hint,
  value,
  onValueChange,
  first,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  /** The row is the first in its Card: no hairline above it. */
  first?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        minHeight: ROW_HEIGHT,
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.sm,
        position: 'relative',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {!first && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            left: 16,
            height: 1,
            backgroundColor: t.color.border,
          }}
        />
      )}
      <View style={{ flex: 1 }}>
        <Text style={[t.type.body, { color: t.color.text }]}>{label}</Text>
        {!!hint && <Text style={[t.type.label, { color: t.color.textMuted }]}>{hint}</Text>}
      </View>
      <View pointerEvents="none">
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ false: t.color.border, true: t.color.accent }}
          thumbColor={t.color.surface}
          style={
            Platform.OS === 'android'
              ? { transform: [{ scale: 0.82 }], marginRight: -4 }
              : undefined
          }
        />
      </View>
    </Pressable>
  );
}

/**
 * A label/value line. Rows stack inside a Card and draw their own hairline separator.
 * @deprecated Kit V2: use ListRow (docs/UI_KIT.md §3)
 */
export function Row({
  label,
  subtitle,
  value,
  icon,
  leading,
  chevron,
  onPress,
  tone,
  check,
  first,
  loading,
  style,
}: {
  label: string;
  subtitle?: string;
  /** Omitted on an action row (Delete, Duplicate): it shows `icon` there instead of a value. */
  value?: string;
  /** What the action does, where a value would be. */
  icon?: keyof typeof Ionicons.glyphMap;
  leading?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  tone?: 'default' | 'warn' | 'danger';
  check?: boolean;
  first?: boolean;
  /** The value is still being read: a spinner stands where "—" would flash. */
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  // Labels are ink and values grey (kit board 1); a tone still colours the value.
  const valueColor =
    tone === 'warn' ? t.color.warn : tone === 'danger' ? t.color.danger : t.color.textMuted;
  const content = (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.md,
          minHeight: ROW_HEIGHT,
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.sm,
          position: 'relative',
        },
        style,
      ]}
    >
      {check && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            backgroundColor: t.color.warn,
          }}
        />
      )}
      {!first && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            left: leading ? 56 : 16,
            height: 1,
            backgroundColor: t.color.border,
          }}
        />
      )}
      {leading}
      {subtitle ? (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[t.type.body, { color: t.color.text }]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      ) : (
        <Text style={[t.type.body, { color: t.color.text, flexShrink: 0 }]}>{label}</Text>
      )}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <ActivityIndicator
            size="small"
            color={t.color.accent}
            accessibilityLabel={tr('common.loading')}
          />
        </View>
      ) : value !== undefined || !icon ? (
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 6,
          }}
        >
          {check && (
            <View
              style={{
                backgroundColor: t.color.warnSoft,
                borderRadius: 4,
                paddingHorizontal: 5,
                paddingVertical: 1,
              }}
            >
              <Text style={{ color: t.color.warn, fontSize: 11, fontWeight: '600' }}>
                {tr('common.check')}
              </Text>
            </View>
          )}
          <Text style={[t.type.body, { color: valueColor, textAlign: 'right' }]} numberOfLines={1}>
            {value ? value.replace(/ /g, '\u00A0') : '—'}
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Ionicons
            name={icon}
            size={20}
            color={
              tone === 'danger'
                ? t.color.danger
                : tone === 'warn'
                  ? t.color.warn
                  : t.color.textMuted
            }
          />
        </View>
      )}
      {chevron && <Ionicons name="chevron-forward" size={16} color={t.color.textFaint} />}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => pressedStyle(pressed)}>
      {content}
    </Pressable>
  ) : (
    content
  );
}
