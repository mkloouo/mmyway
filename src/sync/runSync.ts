// Single entry point every caller uses (app-open, AppState resume, manual "Sync now").
// Fixed order per brief §5.4/§5.5: pull reference data first (fresh cached_transactions.updated_at
// for the replay conflict check) -> replay the outbox -> pull recurring -> re-pull recent
// transactions only if the replay actually created something server-side worth re-pulling.
// Never throws: a sync failure is a status the caller displays, not a crash.
import { readStoredCredentials } from '../api/ff3/auth';
import { getClient } from '../api/ff3/session';
import { getLocalModelBaseUrl, setLastSyncedAt } from '../settings/appSettings';
import { probeReachability } from './reachability';
import { pullReferenceData, pullRecentTransactions } from './referenceData';
import { replayOutbox, type OutboxDb } from './outbox';
import { pullUnreviewedRecurring } from './recurringReview';

export interface SyncSummary {
  signedIn: boolean;
  ff3Reachable: boolean;
  providersReachable: Record<string, boolean>;
  replaySucceeded: number;
  replayConflicted: number;
  recurringCreated: number;
  failedAt: string | null;
  error: string | null;
}

const NOT_SIGNED_IN: SyncSummary = {
  signedIn: false, ff3Reachable: false, providersReachable: {},
  replaySucceeded: 0, replayConflicted: 0, recurringCreated: 0, failedAt: null, error: null,
};

export async function runSync(db: OutboxDb): Promise<SyncSummary> {
  const client = await getClient();
  if (!client) return NOT_SIGNED_IN;

  const summary: SyncSummary = {
    signedIn: true, ff3Reachable: false, providersReachable: {},
    replaySucceeded: 0, replayConflicted: 0, recurringCreated: 0, failedAt: null, error: null,
  };

  try {
    const [credentials, localModelBaseUrl] = await Promise.all([readStoredCredentials(), getLocalModelBaseUrl(db)]);
    const reachability = await probeReachability({
      ff3: credentials,
      providers: localModelBaseUrl ? { local: `${localModelBaseUrl.replace(/\/+$/, '')}/v1/models` } : {},
    });
    summary.ff3Reachable = reachability.ff3;
    summary.providersReachable = reachability.providers;

    await pullReferenceData(db, client);

    const replay = await replayOutbox(db, client);
    summary.replaySucceeded = replay.succeeded.length;
    summary.replayConflicted = replay.conflicted.length;
    summary.failedAt = replay.failedAt;

    summary.recurringCreated = await pullUnreviewedRecurring(db, client);

    if (replay.succeeded.length > 0) {
      await pullRecentTransactions(db, client, new Date().toISOString());
    }

    await setLastSyncedAt(db, new Date().toISOString());
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
  }

  return summary;
}
