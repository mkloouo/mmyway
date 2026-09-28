import i18n from '../i18n';
import { logLine } from '../utils/log';

/**
 * Runs a button handler's async work, and on failure logs it (so it's in the diagnostics log a
 * release build otherwise drops silently) and hands the screen a message for its own toast or
 * snackbar. `action` names the button, e.g. "Confirm" -> "Confirm failed" (already translated by the caller).
 */
export async function reportErrors(
  action: string,
  fn: () => Promise<void>,
  onError: (message: string) => void,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logLine('error', `${action} failed: ${err instanceof Error ? err.message : String(err)}`);
    onError(i18n.t('common.actionFailed', { action }));
  }
}
