// Biometric app lock: the decision of *whether* to be locked (pure, tested here) kept apart from
// the prompt itself (expo-local-authentication) and from the overlay (src/ui/LockGate.tsx).
//
// `lastUnlockedAt` is deliberately held in memory by the caller and never persisted: a cold start
// has nothing to compare against, so it locks, which is what "lock on launch" means. Persisting it
// would let killing and reopening the app skip the lock.
import * as LocalAuthentication from 'expo-local-authentication';
import { logLine } from '../utils/log';
import { errorMessage } from '../utils/errorMessage';

/**
 * How long the app may sit in the background before it locks again. Generous on purpose: capture
 * hands off to the camera or the gallery as a separate activity, and a tighter window re-locked
 * the app in the middle of adding a receipt.
 * ponytail: a constant, not a setting — make it one if anyone actually wants a different window.
 */
export const LOCK_GRACE_MS = 2 * 60 * 1000;

export function shouldLock(opts: {
  enabled: boolean;
  /** Epoch ms of the last successful unlock, or null when there hasn't been one this process. */
  lastUnlockedAt: number | null;
  now: number;
  graceMs?: number;
}): boolean {
  const { enabled, lastUnlockedAt, now, graceMs = LOCK_GRACE_MS } = opts;
  if (!enabled) return false;
  if (lastUnlockedAt === null) return true;
  return now - lastUnlockedAt > graceMs;
}

/**
 * Whether the phone can actually authenticate: hardware present *and* something enrolled. Both
 * matter — a user who turns the lock on and then removes their fingerprints would otherwise be
 * shut out of their own ledger with no way back in, so every caller treats "can't" as "don't lock".
 */
export async function canUseAppLock(): Promise<boolean> {
  try {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && isEnrolled;
  } catch (err) {
    logLine('warn', `could not read biometric capability: ${errorMessage(err)}`);
    return false;
  }
}

/**
 * Prompts, and says whether it succeeded. The device PIN/pattern/password stays available as the
 * fallback (expo-local-authentication offers it unless `disableDeviceFallback` is set), so a wet
 * finger is an inconvenience rather than a lockout.
 */
export async function authenticate(promptMessage: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      // No app-level cancel: the only ways past the overlay are authenticating or leaving the app.
      disableDeviceFallback: false,
    });
    return result.success;
  } catch (err) {
    logLine('warn', `biometric prompt failed: ${errorMessage(err)}`);
    return false;
  }
}
