// Signing in to a Firefly III instance, and what that means for the data already on the phone.
// One code path for both ways in: Settings → Firefly III, and the Dev build's e2e sign-in link
// (app/e2e-sign-in.tsx).
import { readStoredCredentials, signIn } from '../api/ff3/auth';
import { readHosts } from '../api/ff3/hosts';
import type { AuthErrorReason } from '../api/ff3/types';
import i18n from '../i18n';
import {
  clearInstanceData,
  describeQueuedOperations,
  isSameInstance,
  queuedOperationCount,
} from '../sync/instanceData';
import type { OutboxDb } from '../sync/outbox';
import { withSyncPaused } from '../sync/runSync';

const SIGN_IN_ERROR_KEYS: Record<AuthErrorReason, string> = {
  invalid_host: 'settings.signInErrors.invalidHost',
  invalid_api_key: 'settings.signInErrors.invalidApiKey',
  unexpected_status: 'settings.signInErrors.unexpectedStatus',
  not_a_firefly_instance: 'settings.signInErrors.notAFireflyInstance',
  api_version_too_low: 'settings.signInErrors.apiVersionTooLow',
};

export type ConnectResult =
  | { status: 'connected' }
  /** Signing in somewhere new is refused while changes for the current instance are queued. */
  | { status: 'queued'; count: number }
  | { status: 'failed'; reason: AuthErrorReason };

/**
 * Signs in, treating an address not already stored as another instance: refused while anything is
 * queued (those operations carry the current instance's ids), and once it succeeds the current
 * instance's synced data is cleared. A new token at a stored address keeps everything.
 */
export async function connectToInstance(
  db: OutboxDb,
  host: string,
  token: string,
): Promise<ConnectResult> {
  const switching = !!(await readStoredCredentials()) && !isSameInstance(await readHosts(), host);
  if (switching) {
    const count = await queuedOperationCount(db);
    if (count > 0) return { status: 'queued', count };
  }
  // The new token is stored and the old instance's rows cleared with no sync in between.
  const result = await withSyncPaused(async () => {
    const signedInAs = await signIn(host, token);
    if (signedInAs.ok && switching) await clearInstanceData(db);
    return signedInAs;
  });
  return result.ok ? { status: 'connected' } : { status: 'failed', reason: result.reason };
}

/** What an alert (or a screen) says when `connectToInstance` didn't connect. */
export function connectFailureText(result: Exclude<ConnectResult, { status: 'connected' }>): {
  title: string;
  message: string;
} {
  return result.status === 'queued'
    ? { title: i18n.t('settings.cantSwitchYet'), message: describeQueuedOperations(result.count) }
    : {
        title: i18n.t('settings.signInFailed'),
        message: i18n.t(SIGN_IN_ERROR_KEYS[result.reason]),
      };
}
