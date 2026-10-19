import type { ReactNode } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme';
import { usePop } from '../feedback';
import { haptics } from '../haptics';
import { PRESSED_OPACITY, pressedStyle } from './rows';
import { useKeyboardHeight } from './sheet';

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
interface ScreenProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  bottom?: boolean;
  avoidKeyboard?: boolean;
  /**
   * A route presented as a modal. On iOS that is a page sheet, which already starts below the
   * status bar, so the window's top inset (from the root SafeAreaProvider) doubled the gap above
   * its bar. The sheet measures its own insets instead: no top, the home indicator still at the
   * bottom. Android shows modals full screen, so the window's insets are right there.
   */
  modal?: boolean;
}

export function Screen(props: ScreenProps) {
  const t = useTheme();
  if (props.modal && Platform.OS === 'ios') {
    return (
      <SafeAreaProvider style={{ flex: 1, backgroundColor: t.color.bg }}>
        <ScreenBody {...props} />
      </SafeAreaProvider>
    );
  }
  return <ScreenBody {...props} />;
}

function ScreenBody({ children, style, bottom, avoidKeyboard }: ScreenProps) {
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
 * The standard top breathing room between the hairline divider and where screen content begins
 * (whether section headers, chips, balance cards, or cards), normalized to the spacing between
 * account chips and filter chips (12px).
 */
export const SCREEN_TOP_PADDING = 12;

export function SectionHeader({
  title,
  action,
  first = false,
  style,
}: {
  title: string;
  action?: ReactNode;
  first?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: t.space.lg,
          paddingTop: first ? 0 : t.space.xl,
          paddingBottom: t.space.sm,
        },
        style,
      ]}
    >
      <Text style={[t.type.caption, { color: t.color.textMuted, textTransform: 'uppercase' }]}>
        {title}
      </Text>
      {action}
    </View>
  );
}

const DEFAULT_LONG_PRESS_MS = 500; // React Native's own default

/**
 * A white group (kit board 1): 14 px radius, 1 px border, no shadow. `flush` drops its padding and
 * clips to the radius, for a list of rows that bring their own 16 px inset and hairlines.
 */
export function Card({
  children,
  style,
  onPress,
  onLongPress,
  delayLongPress = DEFAULT_LONG_PRESS_MS,
  longPressPop,
  selected,
  accessibilityHint,
  flush,
  testID,
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
  flush?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const popOnHold = !!longPressPop && !!onLongPress;
  const { pop, popStyle } = usePop(1.04);

  const body = (
    <View
      testID={onPress || onLongPress ? undefined : testID}
      style={[
        {
          backgroundColor: t.color.surface,
          borderRadius: t.radius.md,
          borderWidth: 1,
          borderColor: t.color.border,
          padding: t.space.lg,
        },
        flush ? { padding: 0, overflow: 'hidden' } : null,
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
      testID={testID}
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

/** A footnote under a group: indented to sit with the card's text, not its edge. */
export function GroupFooter({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text
      style={[
        t.type.label,
        {
          marginHorizontal: t.space.lg,
          paddingHorizontal: t.space.xs,
          paddingTop: 6,
          color: t.color.textMuted,
        },
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * Hero component (Group HERO use): one big number + its actions.
 * Caption 11/14 caps plus optional info button, display 40/44 amount,
 * optional stats row divided by a hairline, and up to 2 action buttons.
 */
export function Hero({
  caption,
  onInfoPress,
  infoAccessibilityLabel,
  amount,
  tone = 'default',
  subtitle,
  children,
  stats,
  primaryAction,
  secondaryAction,
  actions,
  style,
  testID,
}: {
  caption: string;
  onInfoPress?: () => void;
  infoAccessibilityLabel?: string;
  amount: ReactNode;
  tone?: 'default' | 'warn' | 'income';
  subtitle?: ReactNode;
  children?: ReactNode;
  stats?: { label: string; value: ReactNode }[];
  primaryAction?: { label: string; onPress: () => void; disabled?: boolean };
  secondaryAction?: { label: string; onPress: () => void; disabled?: boolean };
  actions?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const amountColor =
    tone === 'warn' ? t.color.warn : tone === 'income' ? t.color.income : t.color.text;

  return (
    <Card
      testID={testID}
      style={[
        {
          paddingHorizontal: t.space.lg,
          paddingTop: t.space.lg,
          paddingBottom: t.space.md,
          gap: 10,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[t.type.caption, { color: t.color.textMuted, textTransform: 'uppercase' }]}>
          {caption}
        </Text>
        {!!onInfoPress && (
          <Pressable
            onPress={onInfoPress}
            accessibilityRole="button"
            accessibilityLabel={infoAccessibilityLabel ?? 'How this is worked out'}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 28,
              height: 28,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: t.color.border,
              backgroundColor: t.color.surface,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? PRESSED_OPACITY : 1,
            })}
          >
            <Ionicons name="information-outline" size={16} color={t.color.textMuted} />
          </Pressable>
        )}
      </View>

      {typeof amount === 'string' ? (
        <Text style={[t.type.display, { color: amountColor, letterSpacing: -0.5 }]}>{amount}</Text>
      ) : (
        amount
      )}

      {typeof subtitle === 'string' ? (
        <Text style={[t.type.label, { color: t.color.textMuted }]}>{subtitle}</Text>
      ) : (
        subtitle
      )}

      {children}

      {!!stats && stats.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            borderTopWidth: 1,
            borderTopColor: t.color.border,
            paddingTop: 10,
            marginTop: t.space.xs,
          }}
        >
          {stats.map((stat, i) => (
            <View key={stat.label + i} style={{ flex: 1 }}>
              <Text style={[t.type.label, { color: t.color.textMuted }]}>{stat.label}</Text>
              <Text style={[t.type.body, { color: t.color.text, fontWeight: '600' }]}>
                {stat.value}
              </Text>
            </View>
          ))}
        </View>
      )}

      {actions ? (
        actions
      ) : primaryAction || secondaryAction ? (
        <View style={{ flexDirection: 'row', gap: t.space.sm, paddingTop: 6 }}>
          {primaryAction && (
            <Pressable
              onPress={primaryAction.onPress}
              disabled={primaryAction.disabled}
              accessibilityRole="button"
              accessibilityLabel={primaryAction.label}
              style={({ pressed }) => ({
                flex: 1,
                height: 44,
                borderRadius: t.radius.button,
                backgroundColor: primaryAction.disabled ? t.color.accentDisabled : t.color.accent,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? PRESSED_OPACITY : 1,
              })}
            >
              <Text style={[t.type.body, { color: t.color.onAccent, fontWeight: '600' }]}>
                {primaryAction.label}
              </Text>
            </Pressable>
          )}
          {secondaryAction && (
            <Pressable
              onPress={secondaryAction.onPress}
              disabled={secondaryAction.disabled}
              accessibilityRole="button"
              accessibilityLabel={secondaryAction.label}
              style={({ pressed }) => ({
                flex: 1,
                height: 44,
                borderRadius: t.radius.button,
                backgroundColor: t.color.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? PRESSED_OPACITY : 1,
              })}
            >
              <Text style={[t.type.body, { color: t.color.text, fontWeight: '600' }]}>
                {secondaryAction.label}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </Card>
  );
}

/**
 * SummaryCallout: accentSoft block with title 15/600 and lines 13/17.
 * Used for schedule summary and planned payment summaries.
 */
export function SummaryCallout({
  title,
  subtitle,
  children,
  style,
  testID,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: t.color.accentSoft,
          borderRadius: t.radius.md,
          padding: t.space.md,
          gap: t.space.xs,
        },
        style,
      ]}
    >
      <Text style={[t.type.body, { color: t.color.text, fontWeight: '600' }]}>{title}</Text>
      {typeof subtitle === 'string' ? (
        <Text style={[t.type.label, { color: t.color.accentStrong }]}>{subtitle}</Text>
      ) : (
        subtitle
      )}
      {children}
    </View>
  );
}
