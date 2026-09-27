// One thin wrapper over expo-haptics (design §3.4): screens never import the library directly,
// and a call here is a no-op — never a crash — on hardware or a test runner that can't feel it.
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

async function safe(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // best-effort feedback; never blocks the action it's attached to
  }
}

export const haptics = {
  /** A keypad key. Android's own keyboard-tap effect: selectionAsync is barely felt on many phones. */
  key: () => safe(() => (Platform.OS === 'android'
    ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Keyboard_Tap)
    : Haptics.selectionAsync())),
  /** Confirm, a completed swipe. */
  tick: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** A refused action — swipe-confirming an incomplete draft, a blocked save. */
  warn: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  /** A sync that clears the outbox queue. */
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
};
