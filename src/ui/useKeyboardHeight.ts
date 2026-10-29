import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

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
