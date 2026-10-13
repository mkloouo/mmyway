import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme, hitSize } from '../theme';
import { PRESSED_OPACITY } from './rows';

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
 * One bottom sheet serves every picker in the app (design §4, kit board 2). The frame is the page
 * colour with a handle, a 56 px header (title left, round close right) and an optional pinned footer;
 * content groups inside it are Cards. `onBack` adds a chevron left of the title for a page pushed
 * inside the sheet. `scroll` (the default) wraps the body in a ScrollView; pass `scroll={false}`
 * when the caller supplies its own FlatList, which an unbounded list (~400 payees) must — a
 * ScrollView would mount every row.
 * Android back closes it, and the keyboard never covers it: every text field in the app is here.
 */
export function Sheet({
  visible,
  title,
  onClose,
  onBack,
  children,
  footer,
  scroll = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Shows a back chevron in the header, left of the title. */
  onBack?: () => void;
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
  const [slideAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(220);
      Animated.spring(slideAnim, {
        toValue: 0,
        damping: 24,
        stiffness: 260,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: t.color.scrim }]}
          onPress={onClose}
          accessibilityLabel={tr('common.close')}
        />
        <Animated.View
          style={{
            transform: [{ translateY: slideAnim }],
            // A `scroll={false}` body hands us a flex: 1 FlatList that needs a resolved height to
            // fill, not just a ceiling — `maxHeight` alone leaves it collapsed to 0.
            [scroll ? 'maxHeight' : 'height']: '85%',
            backgroundColor: t.color.bg,
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
              height: 5,
              borderRadius: 3,
              backgroundColor: t.color.border,
              marginTop: t.space.sm,
            }}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.space.md,
              height: 56,
              paddingHorizontal: t.space.lg,
            }}
          >
            {!!onBack && (
              // A 44 touch area around the 24 glyph. No label yet: `common.back` isn't in the locales.
              <Pressable
                onPress={onBack}
                accessibilityRole="button"
                hitSlop={4}
                style={({ pressed }) => ({
                  width: hitSize,
                  height: hitSize,
                  marginLeft: -t.space.sm,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? PRESSED_OPACITY : 1,
                })}
              >
                <Ionicons name="chevron-back" size={24} color={t.color.text} />
              </Pressable>
            )}
            <Text style={[t.type.heading, { color: t.color.text, flex: 1, fontWeight: '700' }]}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={tr('common.close')}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: t.color.fill,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? PRESSED_OPACITY : 1,
              })}
            >
              <Ionicons name="close" size={16} color={t.color.textMuted} />
            </Pressable>
          </View>
          {scroll ? (
            <ScrollView contentContainerStyle={bodyPadding} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            <View style={[bodyPadding, { flex: 1 }, footer ? { paddingBottom: 0 } : null]}>
              {children}
            </View>
          )}
          {!!footer && (
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: t.color.border,
                backgroundColor: t.color.bg,
                paddingHorizontal: t.space.lg,
                paddingVertical: t.space.md,
              }}
            >
              {footer}
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}
