import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme';
import { formatMoney, signFor, type DisplayCurrency } from '../money';

/**
 * Short confirmation floating over a screen. Anchored below the status bar inset — Android draws
 * the app edge to edge, so a plain `top: 8` landed inside the camera cutout.
 */
export function Toast({ message }: { message: string | null }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  if (!message) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: insets.top + t.space.sm,
        left: t.space.lg,
        right: t.space.lg,
        alignItems: 'center',
      }}
    >
      <View
        style={{
          backgroundColor: t.color.text,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.sm,
        }}
      >
        <Text style={[t.type.label, { color: t.color.surface }]}>{message}</Text>
      </View>
    </View>
  );
}

export function EmptyState({
  glyph,
  title,
  hint,
  action,
}: {
  glyph: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: t.space.xxxl,
        gap: t.space.md,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: t.color.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 30, color: t.color.accent }}>{glyph}</Text>
      </View>
      <Text style={[t.type.heading, { color: t.color.text }]}>{title}</Text>
      {!!hint && (
        <Text style={[t.type.body, { color: t.color.textMuted, textAlign: 'center' }]}>{hint}</Text>
      )}
      {action}
    </View>
  );
}

/**
 * The small round status dot: a category's colour, a sync state, a pending change. The one place
 * `{ width, height, borderRadius }` for it is written.
 */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
  );
}

/** Opacity loop for "this is working, not stuck": the sync dot and the parsing receipt card. */
export function Pulse({ active, children }: { active: boolean; children: ReactNode }) {
  const [value] = useState(() => new Animated.Value(1));
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

export function StatusPill({
  state,
  label,
}: {
  state: 'ok' | 'syncing' | 'queued' | 'offline' | 'error';
  label: string;
}) {
  const t = useTheme();
  const dot =
    state === 'ok'
      ? t.color.income
      : state === 'queued' || state === 'syncing'
        ? t.color.accent
        : state === 'error'
          ? t.color.danger
          : t.color.textFaint;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.sm,
        paddingHorizontal: t.space.md,
        paddingVertical: t.space.xs,
        borderRadius: t.radius.pill,
        backgroundColor: t.color.surfaceAlt,
        // The TabHeader title takes flex: 1, so without this the pill gets squeezed and its label
        // is clipped mid-word — "just now" rendered as "just".
        flexShrink: 0,
      }}
    >
      <Pulse active={state === 'syncing'}>
        <Dot color={dot} />
      </Pulse>
      <Text style={[t.type.label, { color: t.color.textMuted, flexShrink: 0 }]} numberOfLines={1}>
        {label.replace(/ /g, '\u00A0')}
      </Text>
    </View>
  );
}

/**
 * Renders a decimal-string amount. `type` supplies the sign, so pass the unsigned amount FF3
 * stores; an already-signed string (a day total from `addDecimal`) keeps its own sign.
 */
export function Money({
  amount,
  currency,
  type,
  size = 'body',
  tone,
  loading,
}: {
  amount: string;
  currency: DisplayCurrency;
  type?: 'withdrawal' | 'deposit' | 'transfer';
  size?: 'body' | 'heading' | 'title' | 'display';
  tone?: 'default' | 'warn';
  /** The currencies are still loading: without them the code would stand in for the symbol. */
  loading?: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const signed = amount.trim().startsWith('-') || amount.trim().startsWith('\u2212');
  const color =
    tone === 'warn'
      ? t.color.warn
      : type === 'deposit'
        ? t.color.income
        : type === 'transfer'
          ? t.color.transfer
          : t.color.text;
  if (loading)
    return (
      <View style={{ minHeight: t.type[size].lineHeight }}>
        <ActivityIndicator color={t.color.accent} accessibilityLabel={tr('common.loading')} />
      </View>
    );
  return (
    <Text style={[t.type[size], t.type.money, { color }]} numberOfLines={1}>
      {(type && !signed ? signFor(type) : '') + formatMoney(amount, currency)}
    </Text>
  );
}

/**
 * The warning strip: the Inbox's offline banner, the count's stale and blocker banners, the draft
 * error and the split leftover. `inset` is the rounded card version that sits inside a scroll view;
 * without it the strip runs the full width of the screen.
 * @deprecated Kit V2: use primary Button hint or NoticeBlock (docs/UI_KIT.md §3)
 */
export function Banner({
  children,
  action,
  inset,
}: {
  children: ReactNode;
  action?: ReactNode;
  inset?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.color.warnSoft,
        gap: action ? t.space.sm : 0,
        ...(inset
          ? { marginHorizontal: t.space.lg, padding: t.space.md, borderRadius: t.radius.sm }
          : { paddingHorizontal: t.space.lg, paddingVertical: t.space.sm }),
      }}
    >
      {typeof children === 'string' ? (
        <Text style={[t.type.label, { color: t.color.warn }]}>{children}</Text>
      ) : (
        children
      )}
      {action}
    </View>
  );
}

/**
 * A horizontal progress bar for envelopes and funds: 6 px height, radius 3.
 * Supports accent, warn, or income tones; automatically switches to warn if progress > 1.
 */
export function ProgressBar({
  progress,
  tone = 'accent',
  height = 6,
  style,
}: {
  /** Value from 0 to 1 (or > 1 for overspent). */
  progress: number;
  tone?: 'accent' | 'warn' | 'income';
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const clamped = Math.max(0, Math.min(1, progress));
  const isWarn = tone === 'warn' || progress > 1;
  const trackColor = isWarn ? t.color.warnSoft : t.color.surfaceAlt;
  const fillColor = isWarn ? t.color.warn : tone === 'income' ? t.color.income : t.color.accent;

  return (
    <View
      accessible={true}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[
        {
          height,
          borderRadius: height / 2,
          backgroundColor: trackColor,
          overflow: 'hidden',
          width: '100%',
        },
        style,
      ]}
    >
      <View
        style={{
          width: `${Math.round(clamped * 100)}%`,
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: fillColor,
        }}
      />
    </View>
  );
}

/**
 * A compact badge/pill with semantic tones: warn, income, accent, or muted.
 * Used for status (e.g. "-17,00 short", "Booked", "in use").
 */
export function Pill({
  label,
  tone = 'muted',
  size = 'md',
  dotColor,
  style,
  testID,
}: {
  label: string;
  tone?: 'warn' | 'income' | 'accent' | 'muted';
  size?: 'sm' | 'md';
  dotColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const bg =
    tone === 'warn'
      ? t.color.warnSoft
      : tone === 'income'
        ? t.color.incomeSoft
        : tone === 'accent'
          ? t.color.accentSoft
          : t.color.surfaceAlt;
  const text =
    tone === 'warn'
      ? t.color.warnStrong
      : tone === 'income'
        ? t.color.income
        : tone === 'accent'
          ? t.color.accentStrong
          : t.color.textMuted;

  const isSm = size === 'sm';
  return (
    <View
      testID={testID}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.xs,
          paddingHorizontal: isSm ? t.space.sm : 10,
          paddingVertical: isSm ? 2 : 5,
          borderRadius: t.radius.pill,
          backgroundColor: bg,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      {!!dotColor && <Dot color={dotColor} size={isSm ? 6 : 8} />}
      <Text
        style={[isSm ? t.type.caption : t.type.label, { color: text, fontWeight: '600' }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * Inline notice block in the content (replaces Banner): icon, title 15/600,
 * body 13/17, optional action button.
 */
export function NoticeBlock({
  title,
  body,
  icon,
  action,
  tone = 'warn',
  style,
  testID,
}: {
  title: string;
  body?: string | ReactNode;
  icon?: keyof typeof Ionicons.glyphMap;
  action?: { label: string; onPress: () => void; disabled?: boolean } | ReactNode;
  tone?: 'warn' | 'accent' | 'neutral';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const warn = tone === 'warn';
  const bg = warn ? t.color.warnSoft : tone === 'accent' ? t.color.accentSoft : t.color.surfaceAlt;
  const col = warn ? t.color.warnStrong : tone === 'accent' ? t.color.accentStrong : t.color.text;
  const ic =
    icon ??
    (warn
      ? 'warning-outline'
      : tone === 'accent'
        ? 'information-circle-outline'
        : 'help-circle-outline');
  const act =
    action && typeof action === 'object' && 'label' in action ? (
      <Pressable
        onPress={action.onPress}
        disabled={action.disabled}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        style={({ pressed }) => ({
          height: 36,
          paddingHorizontal: 14,
          borderRadius: 10,
          backgroundColor: t.color.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: action.disabled ? 0.4 : pressed ? 0.8 : 1,
        })}
      >
        <Text style={{ color: t.color.onAccent, fontWeight: '600', fontSize: 14 }}>
          {action.label}
        </Text>
      </Pressable>
    ) : (
      (action as ReactNode)
    );

  return (
    <View
      testID={testID}
      style={[{ backgroundColor: bg, borderRadius: t.radius.md, padding: 14, gap: 10 }, style]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <Ionicons name={ic} size={20} color={col} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[t.type.body, { color: col, fontWeight: '700' }]}>{title}</Text>
          {typeof body === 'string' ? (
            <Text style={[t.type.label, { color: col }]}>{body}</Text>
          ) : (
            body
          )}
        </View>
      </View>
      {!!act && <View style={{ alignItems: 'flex-end' }}>{act}</View>}
    </View>
  );
}
