// Single entry point every caller uses (app-open, AppState resume, manual "Sync now").
// Fixed order per brief §5.4/§5.5: pull reference data first (fresh cached_transactions.updated_at
// for the replay conflict check) -> replay the outbox -> pull recurring -> re-pull recent
// transactions only if the replay actually created something server-side worth re-pulling.
// Never throws: a sync failure is a status the caller displays, not a crash.
import { readStoredCredentials } from '../api/ff3/auth';
import { getClient } from '../api/ff3/session';
import { readHosts } from '../api/ff3/hosts';
import {
  getLocalModelBaseUrls, getLocalModelActiveUrl, setLocalModelActiveUrl,
  getFf3ActiveHost, setFf3ActiveHost, setLastSyncedAt,
} from '../settings/appSettings';
import { probeReachability, type ServerReachability } from './reachability';
import { pullReferenceData, pullRecentTransactions } from './referenceData';
import { replayOutbox, type OutboxDb } from './outbox';
import { pullUnreviewedRecurring } from './recurringReview';
import { retryPendingReceipts } from '../receipt/toDraft';

export interface SyncSummary {
  signedIn: boolean;
  ff3: ServerReachability;
  ff3Reachable: boolean; // derived: any FF3 address answered
  providers: Record<string, ServerReachability>;
  providersReachable: Record<string, boolean>; // derived: any address for that provider answered
  replaySucceeded: number;
  replayConflicted: number;
  recurringCreated: number;
  receiptsParsed: number;
  failedAt: string | null;
  error: string | null;
  lastSyncedAt: string | null;
}

const EMPTY_REACHABILITY: ServerReachability = { winner: null, results: [] };

const NOT_SIGNED_IN: SyncSummary = {
  signedIn: false, ff3: EMPTY_REACHABILITY, ff3Reachable: false, providers: {}, providersReachable: {},
  replaySucceeded: 0, replayConflicted: 0, recurringCreated: 0, receiptsParsed: 0, failedAt: null, error: null,
  lastSyncedAt: null,
};

function anyOk(report: ServerReachability): boolean {
  return report.results.some((r) => r.ok);
}

export async function runSync(db: OutboxDb): Promise<SyncSummary> {
  const client = await getClient(db);
  if (!client) return NOT_SIGNED_IN;

  const summary: SyncSummary = {
    signedIn: true, ff3: EMPTY_REACHABILITY, ff3Reachable: false, providers: {}, providersReachable: {},
    replaySucceeded: 0, replayConflicted: 0, recurringCreated: 0, receiptsParsed: 0, failedAt: null, error: null,
    lastSyncedAt: null,
  };

  try {
    const [credentials, ff3Hosts, ff3ActiveHost, localModelBaseUrls, localModelActiveUrl] = await Promise.all([
      readStoredCredentials(), readHosts(), getFf3ActiveHost(db), getLocalModelBaseUrls(db), getLocalModelActiveUrl(db),
    ]);
    const reachability = await probeReachability({
      ff3: credentials ? { addresses: ff3Hosts, apiToken: credentials.apiToken, remembered: ff3ActiveHost } : null,
      providers: localModelBaseUrls.length > 0 ? { local: { addresses: localModelBaseUrls, remembered: localModelActiveUrl } } : {},
    });
    summary.ff3 = reachability.ff3;
    summary.ff3Reachable = anyOk(reachability.ff3);
    summary.providers = reachability.providers;
    summary.providersReachable = Object.fromEntries(Object.entries(reachability.providers).map(([name, r]) => [name, anyOk(r)]));

    if (reachability.ff3.winner && reachability.ff3.winner !== ff3ActiveHost) await setFf3ActiveHost(db, reachability.ff3.winner);
    if (reachability.providers.local?.winner && reachability.providers.local.winner !== localModelActiveUrl) {
      await setLocalModelActiveUrl(db, reachability.providers.local.winner);
    }

    await pullReferenceData(db, client);

    const replay = await replayOutbox(db, client);
    summary.replaySucceeded = replay.succeeded.length;
    summary.replayConflicted = replay.conflicted.length;
    summary.failedAt = replay.failedAt;

    summary.recurringCreated = await pullUnreviewedRecurring(db, client);
    summary.receiptsParsed = await retryPendingReceipts(db);

    if (replay.succeeded.length > 0) {
      await pullRecentTransactions(db, client, new Date().toISOString());
    }

    summary.lastSyncedAt = new Date().toISOString();
    await setLastSyncedAt(db, summary.lastSyncedAt);
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
  }

  return summary;
}
