import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { appLocale } from '../../i18n';
import { dayDate } from '../../utils/day';
import { useTheme } from '../theme';
import { PRESSED_OPACITY, ROW_HEIGHT } from './rows';

/**
 * ChoiceCard: bordered card for choosing an option (e.g. account kind).
 * Selected state has a 2 px accent border on accentSoft background with role="radio".
 */
export function ChoiceCard({
  testID,
  icon,
  label,
  sub,
  selected,
  onPress,
  disabled,
  style,
}: {
  testID?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      style={({ pressed }) => [
        {
          flex: 1,
          gap: t.space.sm,
          padding: selected ? t.space.md - 1 : t.space.md,
          borderRadius: t.radius.md,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? t.color.accent : t.color.border,
          backgroundColor: selected ? t.color.accentSoft : t.color.surface,
          opacity: disabled ? 0.4 : pressed ? PRESSED_OPACITY : 1,
        },
        style,
      ]}
    >
      {icon && (
        <Ionicons name={icon} size={22} color={selected ? t.color.accent : t.color.textMuted} />
      )}
      <Text style={[t.type.body, { color: t.color.text, fontWeight: '600' }]}>{label}</Text>
      {!!sub && (
        <Text style={[t.type.label, { color: selected ? t.color.accent : t.color.textMuted }]}>
          {sub}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * OptionTiles: 44 px high tiles for 2-4 mutual exclusive options (e.g. "How often": Once/Weekly/Monthly/More).
 * Selected = 2 px accent on accentSoft; role="radiogroup" with radio items.
 */
export function OptionTiles<K extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  disabled,
  style,
  testID,
}: {
  options: { key: K; label: string; sub?: string; disabled?: boolean }[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[{ flexDirection: 'row', gap: 6 }, style]}
    >
      {options.map((opt) => {
        const selected = opt.key === value;
        const optDisabled = disabled || opt.disabled;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            disabled={optDisabled}
            accessibilityRole="radio"
            accessibilityLabel={opt.sub ? `${opt.label}, ${opt.sub}` : opt.label}
            accessibilityState={{ checked: selected, disabled: !!optDisabled }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 44,
              paddingVertical: opt.sub ? 10 : 0,
              paddingHorizontal: 8,
              borderRadius: t.radius.button,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? t.color.accent : t.color.border,
              backgroundColor: selected ? t.color.accentSoft : t.color.surface,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              opacity: optDisabled ? 0.4 : pressed ? PRESSED_OPACITY : 1,
            })}
          >
            <Text
              style={{
                fontSize: 15,
                fontWeight: '600',
                color: selected ? t.color.accentStrong : t.color.text,
              }}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
            {!!opt.sub && (
              <Text
                style={{
                  fontSize: 12,
                  color: selected ? t.color.accentStrong : t.color.textMuted,
                }}
                numberOfLines={1}
              >
                {opt.sub}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Stepper: 36×32 −/+ controls with 18 px glyphs and tabular-nums value between them.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  disabled,
  decreaseAccessibilityLabel,
  increaseAccessibilityLabel,
  testID,
  style,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  decreaseAccessibilityLabel?: string;
  increaseAccessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const canDec = !disabled && value > min;
  const canInc = !disabled && value < max;

  return (
    <View
      testID={testID}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          height: 32,
          borderRadius: t.radius.sm,
          backgroundColor: t.color.surfaceAlt,
        },
        style,
      ]}
    >
      <Pressable
        onPress={() => onChange(Math.max(min, value - step))}
        disabled={!canDec}
        accessibilityRole="button"
        accessibilityLabel={decreaseAccessibilityLabel}
        hitSlop={4}
        style={({ pressed }) => ({
          width: 36,
          height: 32,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: canDec && pressed ? PRESSED_OPACITY : 1,
        })}
      >
        <Ionicons name="remove" size={18} color={canDec ? t.color.text : t.color.textFaint} />
      </Pressable>
      <Text
        style={[
          t.type.body,
          {
            minWidth: 32,
            textAlign: 'center',
            fontWeight: '600',
            color: t.color.text,
            fontVariant: ['tabular-nums'],
          },
        ]}
      >
        {value}
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + step))}
        disabled={!canInc}
        accessibilityRole="button"
        accessibilityLabel={increaseAccessibilityLabel}
        hitSlop={4}
        style={({ pressed }) => ({
          width: 36,
          height: 32,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: canInc && pressed ? PRESSED_OPACITY : 1,
        })}
      >
        <Ionicons name="add" size={18} color={canInc ? t.color.text : t.color.textFaint} />
      </Pressable>
    </View>
  );
}

/**
 * StepperRow: a row in a Card group displaying a label and unit with a Stepper on the right.
 */
export function StepperRow({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  unit,
  format,
  first = false,
  disabled,
  style,
  testID,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  format?: (value: number) => string;
  first?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const displayValue = format ? format(value) : unit ? `${value} ${unit}` : '';

  return (
    <View
      testID={testID}
      style={[
        {
          minHeight: ROW_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: t.space.md,
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.sm,
          borderTopWidth: first ? 0 : 1,
          borderTopColor: t.color.border,
        },
        style,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[t.type.body, { color: t.color.text }]}>
          {label}
          {displayValue ? ` · ${displayValue}` : ''}
        </Text>
      </View>
      <Stepper
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
      />
    </View>
  );
}

/**
 * DateTile: 40 px column date tile with uppercase weekday or month caption (11/600)
 * and day of the month (17/700). Used for planned payment rows and budget due-date cards.
 */
export function DateTile({
  date,
  mode = 'weekday',
  style,
  testID,
}: {
  date: string | Date;
  /** 'weekday' shows 3-letter weekday (e.g. THU); 'month' shows 3-letter month (e.g. OCT). */
  mode?: 'weekday' | 'month';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const d = typeof date === 'string' ? dayDate(date) : date;
  const topText =
    mode === 'month'
      ? d.toLocaleDateString(appLocale(), { month: 'short' }).toUpperCase()
      : d.toLocaleDateString(appLocale(), { weekday: 'short' }).toUpperCase();
  const dayNumber = d.getDate();

  return (
    <View
      testID={testID}
      style={[{ width: 40, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Text style={[t.type.caption, { color: t.color.textMuted, textTransform: 'uppercase' }]}>
        {topText}
      </Text>
      <Text style={[t.type.heading, { color: t.color.text, fontWeight: '700' }]}>{dayNumber}</Text>
    </View>
  );
}
