// Single entry point every caller uses (app-open, AppState resume, manual "Sync now").
// Fixed order per brief §5.4/§5.5: pull reference data first (fresh cached_transactions.updated_at
// for the replay conflict check) -> replay the outbox -> pull recurring -> re-pull recent
// transactions only if the replay actually created something server-side worth re-pulling.
// Never throws: a sync failure is a status the caller displays, not a crash.
import { readStoredCredentials } from '../api/ff3/auth';
import { clientFor } from '../api/ff3/session';
import { readHosts } from '../api/ff3/hosts';
import {
  getLocalModelBaseUrls, getLocalModelActiveUrl, setLocalModelActiveUrl,
  getFf3ActiveHost, setFf3ActiveHost, getLastSyncedAt, setLastSyncedAt,
} from '../settings/appSettings';
import { probeReachability, type ServerReachability } from './reachability';
import { pullReferenceData, pullRecentTransactions } from './referenceData';
import { replayOutbox, recoverInFlight, type OutboxDb } from './outbox';
import { pruneReferenceData, reapplyQueuedAccountEdits } from './referenceHygiene';
import { pullUnreviewedRecurring } from './recurringReview';
import { retryPendingReceipts } from '../receipt/toDraft';
import { logLine } from '../utils/log';

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

let inFlight: Promise<SyncSummary> | null = null;
let recovered = false;

/**
 * One sync at a time, process-wide: a call while one is running gets the running one's result.
 * Every trigger (app open, resume, pull-to-refresh, "Retry now", a just-queued write) funnels
 * through here, so two outbox replays can never run side by side.
 */
export function runSync(db: OutboxDb): Promise<SyncSummary> {
  if (!inFlight) inFlight = doSync(db).finally(() => { inFlight = null; });
  return inFlight;
}

async function doSync(db: OutboxDb): Promise<SyncSummary> {
  const [credentials, ff3Hosts, ff3ActiveHost, localModelBaseUrls, localModelActiveUrl, lastSyncedAt] = await Promise.all([
    readStoredCredentials(), readHosts(), getFf3ActiveHost(db), getLocalModelBaseUrls(db), getLocalModelActiveUrl(db), getLastSyncedAt(db),
  ]);
  if (!credentials) return { ...NOT_SIGNED_IN };

  const summary: SyncSummary = {
    signedIn: true, ff3: EMPTY_REACHABILITY, ff3Reachable: false, providers: {}, providersReachable: {},
    replaySucceeded: 0, replayConflicted: 0, recurringCreated: 0, receiptsParsed: 0, failedAt: null, error: null,
    lastSyncedAt: null,
  };

  try {
    if (!recovered) {
      await recoverInFlight(db);
      recovered = true;
    }

    const reachability = await probeReachability({
      ff3: { addresses: ff3Hosts, apiToken: credentials.apiToken, remembered: ff3ActiveHost },
      providers: localModelBaseUrls.length > 0 ? { local: { addresses: localModelBaseUrls, remembered: localModelActiveUrl } } : {},
    });
    summary.ff3 = reachability.ff3;
    summary.ff3Reachable = anyOk(reachability.ff3);
    summary.providers = reachability.providers;
    summary.providersReachable = Object.fromEntries(Object.entries(reachability.providers).map(([name, r]) => [name, anyOk(r)]));

    if (reachability.providers.local?.winner && reachability.providers.local.winner !== localModelActiveUrl) {
      await setLocalModelActiveUrl(db, reachability.providers.local.winner);
    }

    const winner = reachability.ff3.winner;
    if (winner) {
      if (winner !== ff3ActiveHost) await setFf3ActiveHost(db, winner);
      // Built from the address that just answered — not a client memoised from an earlier sync,
      // which may point at an address that is no longer reachable.
      const client = clientFor(winner, credentials.apiToken);

      const pullStartedAt = new Date().toISOString();
      await pullReferenceData(db, client);
      await pruneReferenceData(db, pullStartedAt);
      await reapplyQueuedAccountEdits(db);

      const replay = await replayOutbox(db, client);
      summary.replaySucceeded = replay.succeeded.length;
      summary.replayConflicted = replay.conflicted.length;
      summary.failedAt = replay.failedAt;

      summary.recurringCreated = await pullUnreviewedRecurring(db, client, { since: lastSyncedAt });

      if (replay.succeeded.length > 0) {
        await pullRecentTransactions(db, client, new Date().toISOString());
      }
    }

    // Independent of FF3 (brief §5.4: a draft can be parsed now and sent later) — a receipt
    // reader can be reachable while Firefly III is not.
    summary.receiptsParsed = await retryPendingReceipts(db);

    if (winner) {
      summary.lastSyncedAt = new Date().toISOString();
      await setLastSyncedAt(db, summary.lastSyncedAt);
    }
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
    logLine('error', `sync failed: ${summary.error}${err instanceof Error && err.stack ? `\n${err.stack}` : ''}`);
  }

  return summary;
}
