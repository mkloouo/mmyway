// Wraps a screen's async handler so a failure is logged and shown instead of becoming an unhandled
// rejection that a release build swallows (the button just seems to do nothing). `action` names the
// button for the message ("Save failed"); onError defaults to an alert.
import { useCallback } from 'react';
import { Alert } from 'react-native';
import { reportErrors } from './reportError';

export function useAction(onError?: (message: string) => void) {
  return useCallback(
    <A extends unknown[]>(action: string, fn: (...args: A) => Promise<void>) =>
      (...args: A): Promise<void> =>
        reportErrors(action, () => fn(...args), onError ?? ((message) => Alert.alert(message))),
    [onError],
  );
}
