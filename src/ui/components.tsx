// The whole component kit (design §4). Ten primitives, no styling outside this file:
// a screen that needs a new look adds a variant here rather than inlining styles.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme, hitSize, type Theme } from './theme';
import { formatMoney, signFor, type DisplayCurrency } from './money';
import { useHoldRing } from './feedback';

/**
 * A tab screen leaves the bottom edge to the tab bar. A modal screen (capture, count, a draft)
 * has nothing under it but Android's own gesture/nav bar, so it passes `bottom` — without it the
 * last control sits directly on top of the system controls.
 */
export function Screen({ children, style, bottom }: { children: ReactNode; style?: StyleProp<ViewStyle>; bottom?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          flex: 1, backgroundColor: t.color.bg,
          paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right,
          paddingBottom: bottom ? insets.bottom : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Every top bar is this tall, whatever it holds (a title with a subtitle, a search field, a
 * selection count and its actions), so switching between them never moves the screen below.
 */
const BAR_HEIGHT = 72;
/** Icon buttons and buttons in a top bar are all this tall. */
const BAR_CONTROL_SIZE = 40;

/** The row every top bar is laid out in; AppBar uses it, and so does a bar that swaps in a search field. */
export function BarRow({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ height: BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingHorizontal: t.space.lg }}>
      {children}
    </View>
  );
}

export function AppBar({ title, subtitle, left, right }: { title: string; subtitle?: string; left?: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <BarRow>
      {left}
      <View style={{ flex: 1 }}>
        <Text style={[t.type.title, { color: t.color.text }]} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {!!right && <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>{right}</View>}
    </BarRow>
  );
}

/** The one look for an icon action in a top bar (close, search, more, settings). */
export function BarIconButton({
  icon, label, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({
        width: BAR_CONTROL_SIZE, height: BAR_CONTROL_SIZE, borderRadius: t.radius.pill,
        alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={24} color={t.color.text} />
    </Pressable>
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

const DEFAULT_LONG_PRESS_MS = 500; // React Native's own default

export function Card({
  children, style, onPress, onLongPress, delayLongPress = DEFAULT_LONG_PRESS_MS, longPressRing, selected, accessibilityHint,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** Starts multi-select (Inbox, Activity) or opens a detail page (Settings → Accounts). */
  onLongPress?: () => void;
  delayLongPress?: number;
  /**
   * The hold feedback from src/ui/feedback.ts (useHoldRing): an accent border grows while the
   * card is held; when the long press fires it's full, with the tick haptic and a pop.
   */
  longPressRing?: boolean;
  selected?: boolean;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const ring = !!longPressRing && !!onLongPress;
  const hold = useHoldRing(delayLongPress);

  const body = (
    <View
      style={[
        { backgroundColor: t.color.surface, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.color.border, padding: t.space.lg },
        selected ? { borderColor: t.color.accent, borderWidth: 2, backgroundColor: t.color.accentSoft } : null,
        style,
      ]}
    >
      {children}
      {ring && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, {
            borderRadius: t.radius.md,
            borderColor: t.color.accent,
            borderWidth: hold.progress.interpolate({ inputRange: [0, 1], outputRange: [0, 4] }),
            opacity: hold.progress.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.6, 1] }),
          }]}
        />
      )}
    </View>
  );
  return onPress || onLongPress
    ? (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress && (ring ? () => { hold.fire(); onLongPress(); } : onLongPress)}
        delayLongPress={delayLongPress}
        onPressIn={ring ? hold.start : undefined}
        onPressOut={ring ? hold.stop : undefined}
        accessibilityState={selected !== undefined ? { selected } : undefined}
        accessibilityHint={accessibilityHint}
        // A ringed card doesn't also dim: the growing border is the feedback.
        style={({ pressed }) => ({ opacity: pressed && !ring ? 0.6 : 1 })}
      >
        {ring ? <Animated.View style={hold.popStyle}>{body}</Animated.View> : body}
      </Pressable>
    )
    : body;
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
  label, selected, onPress, tone, dotColor, accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: 'default' | 'warn';
  dotColor?: string;
  /** Required when `label` is a bare glyph rather than real text. */
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const border = tone === 'warn' ? t.color.warn : selected ? t.color.accent : t.color.border;
  const fill = tone === 'warn' ? t.color.warnSoft : selected ? t.color.accentSoft : t.color.surfaceAlt;
  const text = tone === 'warn' ? t.color.warn : selected ? t.color.accent : t.color.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
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
  /** `bar`: a text action in a top bar, the same height as a BarIconButton. */
  size?: 'bar' | 'md' | 'lg';
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
          minHeight: size === 'lg' ? 52 : size === 'bar' ? BAR_CONTROL_SIZE : hitSize,
          paddingHorizontal: size === 'bar' ? t.space.lg : t.space.xl,
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
        // The AppBar title takes flex: 1, so without this the pill gets squeezed and its label
        // is clipped mid-word — "just now" rendered as "just".
        flexShrink: 0,
      }}
    >
      <Pulse active={state === 'syncing'}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
      </Pulse>
      <Text style={[t.type.label, { color: t.color.textMuted, flexShrink: 0 }]} numberOfLines={1}>
        {label.replace(/ /g, ' ')}
      </Text>
    </View>
  );
}

/** Opacity loop for "this is working, not stuck": the sync dot and the parsing receipt card. */
export function Pulse({ active, children }: { active: boolean; children: ReactNode }) {
  const value = useMemo(() => new Animated.Value(1), []);
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
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const bodyPadding = { paddingHorizontal: t.space.lg, paddingBottom: t.space.lg, gap: t.space.md };
  // `animationType="slide"` slid the scrim in with the panel, which read as a moving backdrop.
  // `elevation` with only the top corners rounded makes Android draw the shadow as a full opaque
  // rect. Neither is worth keeping.
  //
  // The scrim is an absolute fill *behind* the panel, not a flex sibling above it: as a sibling
  // it stopped where the panel's box began, so the transparent corners outside the rounded top
  // showed the undimmed screen — the white squares.
  //
  // Keyboard: Android draws this app edge to edge, and an edge-to-edge window is not resized for
  // the keyboard (adjustResize no longer applies), so a text field low in a sheet sat under it.
  // The panel lifts itself by the keyboard's reported height instead — on both platforms, so
  // there is no KeyboardAvoidingView to double it up.
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.color.scrim }]} onPress={onClose} accessibilityLabel={tr('common.close')} />
        <View
          style={{
            // A `scroll={false}` body hands us a flex: 1 FlatList that needs a resolved height to
            // fill, not just a ceiling — `maxHeight` alone leaves it collapsed to 0.
            [scroll ? 'maxHeight' : 'height']: '85%',
            backgroundColor: t.color.surface, overflow: 'hidden',
            borderTopLeftRadius: t.radius.lg, borderTopRightRadius: t.radius.lg,
            paddingBottom: keyboardHeight > 0 ? keyboardHeight + t.space.md : t.space.xxl + insets.bottom,
          }}
        >
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.color.border, marginVertical: t.space.md }} />
          <Text style={[t.type.heading, { color: t.color.text, paddingHorizontal: t.space.lg, paddingBottom: t.space.md }]}>{title}</Text>
          {scroll
            ? <ScrollView contentContainerStyle={bodyPadding} keyboardShouldPersistTaps="handled">{children}</ScrollView>
            : <View style={[bodyPadding, { flex: 1 }]}>{children}</View>}
          {!!footer && <View style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.md }}>{footer}</View>}
        </View>
      </View>
    </Modal>
  );
}

/** The on-screen keyboard's height while it is shown, 0 otherwise. */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return height;
}

/**
 * Short confirmation floating over a screen. Anchored below the status bar inset — Android draws
 * the app edge to edge, so a plain `top: 8` landed inside the camera cutout.
 */
export function Toast({ message }: { message: string | null }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  if (!message) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + t.space.sm, left: t.space.lg, right: t.space.lg, alignItems: 'center' }}>
      <View style={{ backgroundColor: t.color.text, borderRadius: t.radius.pill, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm }}>
        <Text style={[t.type.label, { color: t.color.surface }]}>{message}</Text>
      </View>
    </View>
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
