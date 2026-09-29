// Wraps a screen's async handler so a failure is logged and shown instead of becoming an unhandled
// rejection that a release build swallows (the button just seems to do nothing). `action` names the
// button for the message ("Save failed"); onError defaults to an alert.
//
// It also holds the in-flight guard every screen used to write by hand: a second tap while the
// same action is running is dropped, and `act.pending(action)` is what a button reads for its
// label. Handlers are keyed by their `action` string, which is the button's own name — two
// buttons that share a name share the guard, which is what a screen wanted anyway.
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { reportErrors } from './reportError';

export interface ActionRunner {
  <A extends unknown[]>(
    action: string,
    fn: (...args: A) => Promise<void>,
    /** Overrides the hook's error handler for this one handler (a toast instead of an alert). */
    onError?: (message: string) => void,
  ): (...args: A) => Promise<void>;
  /** True while a handler with this `action` is running. */
  pending: (action: string) => boolean;
}

export function useAction(onError?: (message: string) => void): ActionRunner {
  const inFlight = useRef<Set<string>>(new Set());
  const [running, setRunning] = useState<readonly string[]>([]);
  const sync = useCallback(() => setRunning([...inFlight.current]), []);

  const act = useCallback(
    <A extends unknown[]>(
      action: string,
      fn: (...args: A) => Promise<void>,
      handleError?: (message: string) => void,
    ) =>
      async (...args: A): Promise<void> => {
        if (inFlight.current.has(action)) return;
        inFlight.current.add(action);
        sync();
        try {
          await reportErrors(
            action,
            () => fn(...args),
            handleError ?? onError ?? ((m) => Alert.alert(m)),
          );
        } finally {
          inFlight.current.delete(action);
          sync();
        }
      },
    [onError, sync],
  );

  return useMemo(
    () => Object.assign(act, { pending: (action: string) => running.includes(action) }),
    [act, running],
  );
}
