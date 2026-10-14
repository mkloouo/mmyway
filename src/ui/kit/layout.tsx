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
import { useTheme } from '../theme';
import { usePop } from '../feedback';
import { haptics } from '../haptics';
import { pressedStyle } from './rows';
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
