// The whole component kit (design §4). Screens take their styling from this kit and `useTheme()`,
// never from literals: a screen that needs a new look adds a variant here.
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme, hitSize, type Theme } from './theme';
import { formatMoney, signFor, type DisplayCurrency } from './money';
import { usePop } from './feedback';
import { haptics } from './haptics';

/**
 * A tab screen leaves the bottom edge to the tab bar. A modal screen (capture, count, a draft)
 * has nothing under it but Android's own gesture/nav bar, so it passes `bottom` — without it the
 * last control sits directly on top of the system controls.
 *
 * `avoidKeyboard`: for a screen with text fields of its own (not in a Sheet, which handles this
 * itself). Android draws the app edge to edge, so the window isn't resized for the keyboard and a
 * lower field sat under it. The screen shrinks by the keyboard's height instead; its ScrollView,
 * made shorter, scrolls the focused field back into view.
 */
export function Screen({
  children,
  style,
  bottom,
  avoidKeyboard,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  bottom?: boolean;
  avoidKeyboard?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // Only screens that ask listen: every tab stays mounted, and each would re-render on every keyboard.
  const keyboardHeight = useKeyboardHeight(!!avoidKeyboard);
  const lifted = keyboardHeight > 0;
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: t.color.bg,
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingBottom: lifted ? keyboardHeight : bottom ? insets.bottom : 0,
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
    <View
      style={{
        height: BAR_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
      }}
    >
      {children}
    </View>
  );
}

export function AppBar({
  title,
  subtitle,
  left,
  right,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
}) {
  const t = useTheme();
  return (
    <BarRow>
      {left}
      <View style={{ flex: 1 }}>
        <Text style={[t.type.title, { color: t.color.text }]} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {!!right && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>{right}</View>
      )}
    </BarRow>
  );
}

/** The one look for an icon action in a top bar (close, search, more, settings). */
export function BarIconButton({
  icon,
  label,
  onPress,
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
        width: BAR_CONTROL_SIZE,
        height: BAR_CONTROL_SIZE,
        borderRadius: t.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? PRESSED_OPACITY : 1,
      })}
    >
      <Ionicons name={icon} size={24} color={t.color.text} />
    </Pressable>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: t.space.lg,
        paddingTop: t.space.xl,
        paddingBottom: t.space.sm,
      }}
    >
      <Text style={[t.type.caption, { color: t.color.textMuted, textTransform: 'uppercase' }]}>
        {title}
      </Text>
      {action}
    </View>
  );
}

const DEFAULT_LONG_PRESS_MS = 500; // React Native's own default

export function Card({
  children,
  style,
  onPress,
  onLongPress,
  delayLongPress = DEFAULT_LONG_PRESS_MS,
  longPressPop,
  selected,
  accessibilityHint,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** Starts multi-select (Inbox, Activity) or opens a detail page (Settings → Accounts). */
  onLongPress?: () => void;
  delayLongPress?: number;
  /**
   * When the long press fires, the tick haptic and a pop (src/ui/feedback.ts). There used to be
   * an accent border growing while the card was held; it read as the card turning bold.
   */
  longPressPop?: boolean;
  selected?: boolean;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const popOnHold = !!longPressPop && !!onLongPress;
  const { pop, popStyle } = usePop(1.04);

  const body = (
    <View
      style={[
        {
          backgroundColor: t.color.surface,
          borderRadius: t.radius.md,
          borderWidth: 1,
          borderColor: t.color.border,
          padding: t.space.lg,
        },
        selected
          ? { borderColor: t.color.accent, borderWidth: 2, backgroundColor: t.color.accentSoft }
          : null,
        style,
      ]}
    >
      {children}
    </View>
  );
  return onPress || onLongPress ? (
    <Pressable
      onPress={onPress}
      onLongPress={
        onLongPress &&
        (popOnHold
          ? () => {
              void haptics.tick();
              pop();
              onLongPress();
            }
          : onLongPress)
      }
      delayLongPress={delayLongPress}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => pressedStyle(pressed)}
    >
      {popOnHold ? <Animated.View style={popStyle}>{body}</Animated.View> : body}
    </Pressable>
  ) : (
    body
  );
}

/** A label/value line. Rows stack inside a Card and draw their own hairline separator. */
export function Row({
  label,
  value,
  icon,
  leading,
  chevron,
  onPress,
  tone,
  first,
  loading,
}: {
  label: string;
  /** Omitted on an action row (Delete, Duplicate): it shows `icon` there instead of a value. */
  value?: string;
  /** What the action does, where a value would be. */
  icon?: keyof typeof Ionicons.glyphMap;
  leading?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  tone?: 'default' | 'warn' | 'danger';
  first?: boolean;
  /** The value is still being read: a spinner stands where "—" would flash. */
  loading?: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const valueColor =
    tone === 'warn' ? t.color.warn : tone === 'danger' ? t.color.danger : t.color.text;
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        minHeight: hitSize,
        paddingVertical: t.space.sm,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.color.border,
      }}
    >
      {leading}
      <Text style={[t.type.body, { color: t.color.textMuted, flexShrink: 0 }]}>{label}</Text>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <ActivityIndicator
            size="small"
            color={t.color.accent}
            accessibilityLabel={tr('common.loading')}
          />
        </View>
      ) : value !== undefined || !icon ? (
        <Text
          style={[t.type.body, { color: valueColor, flex: 1, textAlign: 'right' }]}
          numberOfLines={1}
        >
          {value ?? '—'}
        </Text>
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
      {chevron && <Text style={[t.type.body, { color: t.color.textFaint }]}>›</Text>}
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

const CHIP_HEIGHT = 36;
const CHIP_SLOP = (hitSize - CHIP_HEIGHT) / 2;

export function Chip({
  label,
  selected,
  onPress,
  tone,
  dotColor,
  accessibilityLabel,
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
  const fill =
    tone === 'warn' ? t.color.warnSoft : selected ? t.color.accentSoft : t.color.surfaceAlt;
  const text = tone === 'warn' ? t.color.warn : selected ? t.color.accent : t.color.text;
  return (
    <Pressable
      onPress={onPress}
      // A chip is drawn 36 dp tall; the touch area reaches the kit's 44 above and below it.
      hitSlop={{ top: CHIP_SLOP, bottom: CHIP_SLOP }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
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
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** `bar`: a text action in a top bar, the same height as a BarIconButton. */
  size?: 'bar' | 'md' | 'lg';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** For a title that is an emoji or a glyph: what a screen reader should say instead. */
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const fill =
    variant === 'primary'
      ? t.color.accent
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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        {
          minHeight: size === 'lg' ? 52 : size === 'bar' ? BAR_CONTROL_SIZE : hitSize,
          paddingHorizontal: size === 'bar' ? t.space.lg : t.space.xl,
          borderRadius: t.radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: fill,
          opacity: disabled ? 0.4 : pressed ? PRESSED_OPACITY : 1,
        },
        style,
      ]}
    >
      <Text
        style={[size === 'lg' ? t.type.heading : t.type.body, { color: label, fontWeight: '600' }]}
      >
        {title}
      </Text>
    </Pressable>
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
  loading,
}: {
  amount: string;
  currency: DisplayCurrency;
  type?: 'withdrawal' | 'deposit' | 'transfer';
  size?: 'body' | 'heading' | 'title' | 'display';
  /** The currencies are still loading: without them the code would stand in for the symbol. */
  loading?: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const signed = amount.trim().startsWith('-') || amount.trim().startsWith('−');
  const color =
    type === 'deposit' ? t.color.income : type === 'transfer' ? t.color.transfer : t.color.text;
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
        // The AppBar title takes flex: 1, so without this the pill gets squeezed and its label
        // is clipped mid-word — "just now" rendered as "just".
        flexShrink: 0,
      }}
    >
      <Pulse active={state === 'syncing'}>
        <Dot color={dot} />
      </Pulse>
      <Text style={[t.type.label, { color: t.color.textMuted, flexShrink: 0 }]} numberOfLines={1}>
        {label.replace(/ /g, ' ')}
      </Text>
    </View>
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

/**
 * One bottom sheet serves every picker in the app (design §4). `scroll` (the default) wraps the
 * body in a ScrollView; pass `scroll={false}` when the caller supplies its own FlatList, which an
 * unbounded list (~400 payees) must — a ScrollView would mount every row.
 * Android back closes it, and the keyboard never covers it: every text field in the app is here.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  footer,
  scroll = true,
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
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: t.color.scrim }]}
          onPress={onClose}
          accessibilityLabel={tr('common.close')}
        />
        <View
          style={{
            // A `scroll={false}` body hands us a flex: 1 FlatList that needs a resolved height to
            // fill, not just a ceiling — `maxHeight` alone leaves it collapsed to 0.
            [scroll ? 'maxHeight' : 'height']: '85%',
            backgroundColor: t.color.surface,
            overflow: 'hidden',
            borderTopLeftRadius: t.radius.lg,
            borderTopRightRadius: t.radius.lg,
            paddingBottom:
              keyboardHeight > 0 ? keyboardHeight + t.space.md : t.space.xxl + insets.bottom,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: t.color.border,
              marginVertical: t.space.md,
            }}
          />
          <Text
            style={[
              t.type.heading,
              { color: t.color.text, paddingHorizontal: t.space.lg, paddingBottom: t.space.md },
            ]}
          >
            {title}
          </Text>
          {scroll ? (
            <ScrollView contentContainerStyle={bodyPadding} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            <View style={[bodyPadding, { flex: 1 }]}>{children}</View>
          )}
          {!!footer && (
            <View style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.md }}>{footer}</View>
          )}
        </View>
      </View>
    </Modal>
  );
}

/** The on-screen keyboard's height while it is shown, 0 otherwise (always 0 when not `enabled`). */
export function useKeyboardHeight(enabled = true): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [enabled]);
  return enabled ? height : 0;
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

/** How far a pressable dims under the finger. One value, so every surface agrees. */
export const PRESSED_OPACITY = 0.6;

/** `style={({ pressed }) => pressedStyle(pressed)}` on a bare Pressable. */
export function pressedStyle(pressed: boolean, style?: ViewStyle): ViewStyle {
  return { ...style, opacity: pressed ? PRESSED_OPACITY : 1 };
}

/** The ✕ in a screen's top bar, which every full-screen route has. */
export function CloseButton({ onPress }: { onPress: () => void }) {
  const { t: tr } = useTranslation();
  return <BarIconButton icon="close" label={tr('common.close')} onPress={onPress} />;
}

/**
 * The warning strip: the Inbox's offline banner, the count's stale and blocker banners, the draft
 * error and the split leftover. `inset` is the rounded card version that sits inside a scroll view;
 * without it the strip runs the full width of the screen.
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
 * The round floating button: the dock's two secondary actions and the aliases screen's ＋. `accent`
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
