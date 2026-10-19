import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme';
import { TextField } from '../TextField';

type IconName = keyof typeof Ionicons.glyphMap;

export const ROW_HEIGHT = 52;
export const PRESSED_OPACITY = 0.6;

export function pressedStyle(pressed: boolean, style?: ViewStyle): ViewStyle {
  return { ...style, opacity: pressed ? PRESSED_OPACITY : 1 };
}

export type TileTone =
  'accent' | 'warn' | 'income' | 'danger' | 'muted' | 'transfer' | 'purple' | 'ink';

// prettier-ignore
const TILE_TONES: Record<TileTone, [bg: string, fg: string]> = {
  warn: ['warnSoft', 'warn'], income: ['surfaceAlt', 'income'], danger: ['dangerSoft', 'danger'],
  muted: ['surfaceAlt', 'textMuted'], accent: ['accentSoft', 'accent'], transfer: ['transferSoft', 'transfer'],
  purple: ['purpleSoft', 'purple'], ink: ['inkSoft', 'ink'],
};

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
  const [bg, fg] = TILE_TONES[tone];
  const c = t.color as unknown as Record<string, string>;
  const radius = size === 28 ? t.radius.xs : Math.round(size * 0.27);
  return (
    <View
      style={[
        styles.center,
        { width: size, height: size, borderRadius: radius, backgroundColor: c[bg] },
      ]}
    >
      <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.57)} color={c[fg]} />
    </View>
  );
}

function RowHairline({ first, leading }: { first?: boolean; leading?: boolean }) {
  const t = useTheme();
  if (first) return null;
  return (
    <View style={[styles.hairline, { left: leading ? 56 : 16, backgroundColor: t.color.border }]} />
  );
}

// prettier-ignore
export interface ListRowProps {
  label: string; sub?: ReactNode; subtitle?: ReactNode; value?: string; leading?: ReactNode; trailing?: ReactNode;
  chevron?: boolean; onPress?: () => void; onLongPress?: () => void; first?: boolean;
  tone?: 'default' | 'warn' | 'danger' | 'accent'; check?: boolean; struck?: boolean; selected?: boolean;
  action?: { label: string; onPress: () => void; tone?: 'accent' | 'muted' | 'danger' };
  loading?: boolean; icon?: IconName; style?: StyleProp<ViewStyle>; hero?: boolean;
}

// prettier-ignore
export function ListRow({
  label, sub, subtitle, value, leading, trailing, chevron, onPress, onLongPress, first,
  tone, check, struck, selected, action, loading, icon, style, hero,
}: ListRowProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const interactive = !!onPress || !!onLongPress;
  const subText = sub ?? subtitle;
  const valCol =
    tone === 'warn' ? t.color.warn : tone === 'danger' ? t.color.danger : t.color.textMuted;
  const lblCol = struck
    ? t.color.textFaint
    : tone === 'danger'
      ? t.color.danger
      : tone === 'accent'
        ? t.color.accent
        : t.color.text;
  const actCol =
    action?.tone === 'danger'
      ? t.color.danger
      : action?.tone === 'muted'
        ? t.color.textMuted
        : t.color.accent;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      pressRetentionOffset={interactive ? { top: 60, bottom: 60, left: 30, right: 30 } : undefined}
      style={({ pressed }) => [
        styles.row,
        {
          gap: t.space.md,
          paddingHorizontal: t.space.lg,
          paddingVertical: hero ? t.space.md : t.space.sm,
          minHeight: hero ? 76 : ROW_HEIGHT,
          opacity: pressed ? PRESSED_OPACITY : 1,
        },
        style,
      ]}
    >
      {check && <View style={[styles.checkBar, { backgroundColor: t.color.warn }]} />}
      <RowHairline first={first || hero} leading={!!leading} />
      {leading}
      <View style={styles.flexShrink}>
        <Text
          style={[
            hero ? t.type.heading : t.type.body,
            {
              color: lblCol,
              textDecorationLine: struck ? 'line-through' : undefined,
              fontWeight: selected ? '700' : hero ? '600' : '400',
            },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {!!subText &&
          (typeof subText === 'string' ? (
            <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
              {subText}
            </Text>
          ) : (
            subText
          ))}
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? PRESSED_OPACITY : 1 }]}
        >
          <Text style={[t.type.label, { fontWeight: '600', color: actCol }]}>{action.label}</Text>
        </Pressable>
      ) : loading ? (
        <View style={styles.endBox}>
          <ActivityIndicator
            size="small"
            color={t.color.accent}
            accessibilityLabel={tr('common.loading')}
          />
        </View>
      ) : (
        <>
          {trailing}
          {value !== undefined && (
            <View style={[styles.valBox, { flex: trailing ? 0 : 1 }]}>
              {check && (
                <View style={[styles.checkTag, { backgroundColor: t.color.warnSoft }]}>
                  <Text style={{ color: t.color.warn, fontSize: 11, fontWeight: '600' }}>
                    {tr('common.check')}
                  </Text>
                </View>
              )}
              <Text
                style={[
                  t.type.body,
                  {
                    color: struck ? t.color.textFaint : valCol,
                    textAlign: 'right',
                    textDecorationLine: struck ? 'line-through' : undefined,
                  },
                ]}
                numberOfLines={1}
              >
                {value ? value.replace(/ /g, '\u00A0') : '—'}
              </Text>
            </View>
          )}
          {icon && !trailing && value === undefined && (
            <View style={styles.endBox}>
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
        </>
      )}
    </Pressable>
  );
}

// prettier-ignore
export interface SwitchRowProps {
  label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void;
  leading?: ReactNode; first?: boolean; disabled?: boolean; bold?: boolean;
}

export function SwitchRow({
  label,
  value,
  onValueChange,
  hint,
  leading,
  first,
  disabled,
  bold,
}: SwitchRowProps) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={[
        styles.row,
        {
          gap: t.space.md,
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.sm,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <RowHairline first={first} leading={!!leading} />
      {leading}
      <View style={styles.flex}>
        <Text style={[t.type.body, { color: t.color.text, fontWeight: bold ? '600' : undefined }]}>
          {label}
        </Text>
        {!!hint && <Text style={[t.type.label, { color: t.color.textMuted }]}>{hint}</Text>}
      </View>
      <View pointerEvents="none">
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ false: t.color.border, true: t.color.accent }}
          thumbColor={t.color.surface}
          style={Platform.OS === 'android' ? styles.androidSwitch : undefined}
        />
      </View>
    </Pressable>
  );
}

// prettier-ignore
export interface RadioRowProps {
  label: string; sub?: string; selected: boolean; onPress?: () => void; first?: boolean; disabled?: boolean;
}

export function RadioRow({ label, sub, selected, onPress, first, disabled }: RadioRowProps) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.row,
        {
          alignItems: sub ? 'flex-start' : 'center',
          gap: t.space.md,
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.sm,
          opacity: disabled ? 0.4 : pressed ? PRESSED_OPACITY : 1,
        },
      ]}
    >
      <RowHairline first={first} />
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[
          styles.radioCircle,
          {
            borderWidth: selected ? 7 : 2,
            borderColor: selected ? t.color.accent : t.color.border,
            marginTop: sub ? 2 : 0,
          },
        ]}
      />
      <View style={styles.flex}>
        <Text style={[t.type.body, { color: t.color.text, fontWeight: selected ? '600' : '400' }]}>
          {label}
        </Text>
        {!!sub && (
          <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// prettier-ignore
export interface FieldRowProps {
  label: string; value?: string; onChangeText?: (text: string) => void; onCommit?: (text: string) => void;
  placeholder?: string; multiline?: boolean; keyboardType?: KeyboardTypeOptions; children?: ReactNode;
  first?: boolean; labelWidth?: number; style?: StyleProp<ViewStyle>;
}

export function FieldRow({
  label,
  value,
  onChangeText,
  onCommit,
  placeholder,
  multiline,
  keyboardType,
  children,
  first,
  labelWidth = 96,
  style,
}: FieldRowProps) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.row,
        { gap: t.space.md, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm },
        style,
      ]}
    >
      <RowHairline first={first} />
      <Text style={[t.type.body, { color: t.color.text, width: labelWidth }]}>{label}</Text>
      {children ?? (
        <TextField
          value={value}
          onChangeText={onChangeText}
          onCommit={onCommit}
          placeholder={placeholder}
          multiline={multiline}
          keyboardType={keyboardType}
          style={styles.fieldInput}
        />
      )}
    </View>
  );
}

// prettier-ignore
const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  flexShrink: { flex: 1, minWidth: 0 },
  row: { minHeight: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', position: 'relative' },
  hairline: { position: 'absolute', top: 0, right: 0, height: 1 },
  checkBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  actionBtn: { minHeight: 44, justifyContent: 'center' },
  endBox: { flex: 1, alignItems: 'flex-end' },
  valBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  checkTag: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  androidSwitch: { transform: [{ scale: 0.82 }], marginRight: -4 },
  radioCircle: { width: 22, height: 22, borderRadius: 11 },
  fieldInput: { flex: 1, borderWidth: 0, paddingHorizontal: 0, paddingVertical: 0, textAlign: 'right', backgroundColor: 'transparent' },
});
