// The whole component kit (design §4). Ten primitives, no styling outside this file:
// a screen that needs a new look adds a variant here rather than inlining styles.
import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, hitSize, type Theme } from './theme';
import { formatMoney, signFor, type DisplayCurrency } from './money';

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[{ flex: 1, backgroundColor: t.color.bg }, style]}>
      {children}
    </SafeAreaView>
  );
}

export function AppBar({ title, subtitle, left, right }: { title: string; subtitle?: string; left?: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingHorizontal: t.space.lg, paddingVertical: t.space.md }}>
      {left}
      <View style={{ flex: 1 }}>
        <Text style={[t.type.title, { color: t.color.text }]} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={[t.type.label, { color: t.color.textMuted }]}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.space.lg, paddingTop: t.space.xl, paddingBottom: t.space.sm }}>
      <Text style={[t.type.caption, { color: t.color.textMuted, textTransform: 'uppercase' }]}>{title}</Text>
      {action}
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const t = useTheme();
  const body = (
    <View style={[{ backgroundColor: t.color.surface, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border, padding: t.space.lg }, style]}>
      {children}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>{body}</Pressable> : body;
}

/** A label/value line. Rows stack inside a Card and draw their own hairline separator. */
export function Row({
  label, value, leading, chevron, onPress, tone, first,
}: {
  label: string;
  value?: string;
  leading?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  tone?: 'default' | 'warn' | 'danger';
  first?: boolean;
}) {
  const t = useTheme();
  const valueColor = tone === 'warn' ? t.color.warn : tone === 'danger' ? t.color.danger : t.color.text;
  const content = (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: hitSize,
        paddingVertical: t.space.sm, borderTopWidth: first ? 0 : 1, borderTopColor: t.color.border,
      }}
    >
      {leading}
      <Text style={[t.type.body, { color: t.color.textMuted, flexShrink: 0 }]}>{label}</Text>
      <Text style={[t.type.body, { color: valueColor, flex: 1, textAlign: 'right' }]} numberOfLines={1}>
        {value ?? '—'}
      </Text>
      {chevron && <Text style={[t.type.body, { color: t.color.textFaint }]}>›</Text>}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>{content}</Pressable> : content;
}

export function Chip({
  label, selected, onPress, tone, dotColor,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: 'default' | 'warn';
  dotColor?: string;
}) {
  const t = useTheme();
  const border = tone === 'warn' ? t.color.warn : selected ? t.color.accent : t.color.border;
  const fill = tone === 'warn' ? t.color.warnSoft : selected ? t.color.accentSoft : t.color.surfaceAlt;
  const text = tone === 'warn' ? t.color.warn : selected ? t.color.accent : t.color.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: t.space.sm,
        minHeight: 36, paddingHorizontal: t.space.md, paddingVertical: t.space.sm,
        borderRadius: t.radius.pill, borderWidth: 1, borderColor: border, backgroundColor: fill,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {!!dotColor && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />}
      <Text style={[t.type.label, { color: text }]}>{label}</Text>
    </Pressable>
  );
}

export function Button({
  title, onPress, variant = 'primary', size = 'md', disabled, style,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const fill = variant === 'primary' ? t.color.accent
    : variant === 'danger' ? t.color.dangerSoft
    : variant === 'secondary' ? t.color.surfaceAlt
    : 'transparent';
  const label = variant === 'primary' ? t.color.onAccent
    : variant === 'danger' ? t.color.danger
    : variant === 'ghost' ? t.color.accent
    : t.color.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        {
          minHeight: size === 'lg' ? 52 : hitSize,
          paddingHorizontal: t.space.xl,
          borderRadius: t.radius.md,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: fill,
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      <Text style={[size === 'lg' ? t.type.heading : t.type.body, { color: label, fontWeight: '600' }]}>{title}</Text>
    </Pressable>
  );
}

/**
 * Renders a decimal-string amount. `type` supplies the sign, so pass the unsigned amount FF3
 * stores; an already-signed string (a day total from `addDecimal`) keeps its own sign.
 */
export function Money({
  amount, currency, type, size = 'body',
}: {
  amount: string;
  currency: DisplayCurrency;
  type?: 'withdrawal' | 'deposit' | 'transfer';
  size?: 'body' | 'heading' | 'title' | 'display';
}) {
  const t = useTheme();
  const signed = amount.trim().startsWith('-') || amount.trim().startsWith('−');
  const color = type === 'deposit' ? t.color.income : type === 'transfer' ? t.color.transfer : t.color.text;
  return (
    <Text style={[t.type[size], t.type.money, { color }]} numberOfLines={1}>
      {(type && !signed ? signFor(type) : '') + formatMoney(amount, currency)}
    </Text>
  );
}

export function StatusPill({ state, label }: { state: 'ok' | 'syncing' | 'queued' | 'offline' | 'error'; label: string }) {
  const t = useTheme();
  const dot = state === 'ok' ? t.color.income
    : state === 'queued' || state === 'syncing' ? t.color.accent
    : state === 'error' ? t.color.danger
    : t.color.textFaint;
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: t.space.sm,
        paddingHorizontal: t.space.md, paddingVertical: t.space.xs,
        borderRadius: t.radius.pill, backgroundColor: t.color.surfaceAlt,
      }}
    >
      <Pulse active={state === 'syncing'}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
      </Pulse>
      <Text style={[t.type.label, { color: t.color.textMuted }]}>{label}</Text>
    </View>
  );
}

/** Opacity loop for "this is working, not stuck": the sync dot and the parsing receipt card. */
export function Pulse({ active, children }: { active: boolean; children: ReactNode }) {
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      value.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        Animated.timing(value, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, value]);
  return <Animated.View style={{ opacity: value }}>{children}</Animated.View>;
}

/**
 * One bottom sheet serves every picker in the app (design §4). `scroll` (the default) wraps the
 * body in a ScrollView; pass `scroll={false}` when the caller supplies its own FlatList, which an
 * unbounded list (~400 payees) must — a ScrollView would mount every row.
 * Android back closes it, and the keyboard never covers it: every text field in the app is here.
 */
export function Sheet({
  visible, title, onClose, children, footer, scroll = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
}) {
  const t = useTheme();
  const bodyPadding = { paddingHorizontal: t.space.lg, paddingBottom: t.space.lg, gap: t.space.md };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: t.color.scrim }} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={{
            maxHeight: '80%', backgroundColor: t.color.surface,
            borderTopLeftRadius: t.radius.lg, borderTopRightRadius: t.radius.lg,
            paddingBottom: t.space.xxl, elevation: 8,
          }}
        >
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.color.border, marginVertical: t.space.md }} />
          <Text style={[t.type.heading, { color: t.color.text, paddingHorizontal: t.space.lg, paddingBottom: t.space.md }]}>{title}</Text>
          {scroll
            ? <ScrollView contentContainerStyle={bodyPadding}>{children}</ScrollView>
            : <View style={[bodyPadding, { flexShrink: 1 }]}>{children}</View>}
          {!!footer && <View style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.md }}>{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function EmptyState({ glyph, title, hint, action }: { glyph: string; title: string; hint?: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', padding: t.space.xxxl, gap: t.space.md }}>
      <View
        style={{
          width: 72, height: 72, borderRadius: 36, backgroundColor: t.color.accentSoft,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 30, color: t.color.accent }}>{glyph}</Text>
      </View>
      <Text style={[t.type.heading, { color: t.color.text }]}>{title}</Text>
      {!!hint && <Text style={[t.type.body, { color: t.color.textMuted, textAlign: 'center' }]}>{hint}</Text>}
      {action}
    </View>
  );
}

export type { Theme };
