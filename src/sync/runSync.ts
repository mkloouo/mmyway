// Single entry point every caller uses (app-open, AppState resume, manual "Sync now").
// Fixed order per brief §5.4/§5.5: pull reference data first (fresh cached_transactions.updated_at
// for the replay conflict check) -> replay the outbox -> pull recurring -> re-read account balances
// and re-pull recent transactions only if the replay actually landed something server-side.
// Never throws: a sync failure is a status the caller displays, not a crash.
import { readStoredCredentials } from '../api/ff3/auth';
import { clientFor } from '../api/ff3/session';
import { readHosts } from '../api/ff3/hosts';
import {
  getLocalModelBaseUrls, getLocalModelActiveUrl, setLocalModelActiveUrl,
  getFf3ActiveHost, setFf3ActiveHost, getLastSyncedAt, setLastSyncedAt, getLocalModelName,
  getBalancesStale, setBalancesStale,
} from '../settings/appSettings';
import { readGeminiKey } from '../settings/secrets';
import { probeReachability, type ServerReachability } from './reachability';
import { pullReferenceData, pullRecentTransactions, pullAccountBalances, backfillCachedTransactions } from './referenceData';
import { warmMerchantLookup } from '../lookup/merchantLookup';
import { replayOutbox, recoverInFlight, pruneUploadedReceiptImages, queuedLedgerOpCount, type OutboxDb } from './outbox';
import { pruneReferenceData, reapplyQueuedAccountEdits } from './referenceHygiene';
import { pullUnreviewedRecurring } from './recurringReview';
import { retryPendingReceipts } from '../receipt/toDraft';
import { logLine } from '../utils/log';
import { pullPlanned } from '../planned/objects';

export interface SyncSummary {
  signedIn: boolean;
  ff3: ServerReachability;
  ff3Reachable: boolean; // derived: any FF3 address answered
  providers: Record<string, ServerReachability>;
  providersReachable: Record<string, boolean>; // derived: any address for that provider answered
  /** Receipt readers with a configuration, probed or not — Gemini has no address to probe. */
  configuredProviders: string[];
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
  signedIn: false, ff3: EMPTY_REACHABILITY, ff3Reachable: false, providers: {}, providersReachable: {}, configuredProviders: [],
  replaySucceeded: 0, replayConflicted: 0, recurringCreated: 0, receiptsParsed: 0, failedAt: null, error: null,
  lastSyncedAt: null,
};

function anyOk(report: ServerReachability): boolean {
  return report.results.some((r) => r.ok);
}

export type SyncMode = 'full' | 'push';

let inFlight: { mode: SyncMode; promise: Promise<SyncSummary> } | null = null;
let recovered = false;

/**
 * One sync at a time, process-wide. Every trigger funnels through here, so two outbox replays can
 * never run side by side.
 *
 * - full (app launch, pull-to-refresh, Sync now, a stale resume): probe servers, pull reference
 *   data, replay the queue, pull recurring reviews, retry receipts.
 * - push (right after a write): replay the queue and, if anything landed, re-read the short
 *   catch-up window so Activity shows it. No reference pull — writes no longer cost a full fetch.
 *
 * A call while one runs joins it, except a full asked for during a push, which runs next.
 */
export function runSync(db: OutboxDb, mode: SyncMode = 'full'): Promise<SyncSummary> {
  if (inFlight && (inFlight.mode === 'full' || mode === 'push')) return inFlight.promise;
  const previous = inFlight?.promise;
  const promise = (previous ? previous.catch(() => undefined).then(() => doSync(db, mode)) : doSync(db, mode))
    .finally(() => { if (inFlight?.promise === promise) inFlight = null; });
  inFlight = { mode, promise };
  return promise;
}

async function doSync(db: OutboxDb, mode: SyncMode): Promise<SyncSummary> {
  const [credentials, ff3Hosts, ff3ActiveHost, localModelBaseUrls, localModelActiveUrl, lastSyncedAt, localModelName, geminiKey] = await Promise.all([
    readStoredCredentials(), readHosts(), getFf3ActiveHost(db), getLocalModelBaseUrls(db), getLocalModelActiveUrl(db), getLastSyncedAt(db),
    getLocalModelName(db), readGeminiKey().catch(() => null),
  ]);
  if (!credentials) return { ...NOT_SIGNED_IN };

  const summary: SyncSummary = {
    signedIn: true, ff3: EMPTY_REACHABILITY, ff3Reachable: false, providers: {}, providersReachable: {},
    replaySucceeded: 0, replayConflicted: 0, recurringCreated: 0, receiptsParsed: 0, failedAt: null, error: null,
    // The last successful full sync; replaced below if this one succeeds. Starting from null
    // made a push sync (which never sets it) show "never" in the Sync sheet.
    lastSyncedAt,
    // Same conditions buildChain uses to put a provider in the chain.
    configuredProviders: [
      ...(localModelBaseUrls.length > 0 && localModelName ? ['local'] : []),
      ...(geminiKey ? ['gemini'] : []),
    ],
  };

  try {
    if (!recovered) {
      await recoverInFlight(db);
      recovered = true;
    }

    const full = mode === 'full';
    const reachability = await probeReachability({
      ff3: { addresses: ff3Hosts, apiToken: credentials.apiToken, remembered: ff3ActiveHost },
      providers: full && localModelBaseUrls.length > 0 ? { local: { addresses: localModelBaseUrls, remembered: localModelActiveUrl } } : {},
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

      if (full) {
        const pullStartedAt = new Date().toISOString();
        await pullReferenceData(db, client);
        await pruneReferenceData(db, pullStartedAt);
        await reapplyQueuedAccountEdits(db);
        await backfillCachedTransactions(db);
        await setBalancesStale(db, false);
      }

      // Marked before sending, not after: a process killed between a write landing and the
      // balance re-read below must still leave the balances marked stale.
      if (await queuedLedgerOpCount(db) > 0) await setBalancesStale(db, true);
      const replay = await replayOutbox(db, client);
      summary.replaySucceeded = replay.succeeded.length;
      summary.replayConflicted = replay.conflicted.length;
      summary.failedAt = replay.failedAt;

      // The Planned tab's subscriptions, rules and recurring transactions — after the replay, so
      // a planned edit that just landed isn't overwritten by the copy from before it. A failure
      // here leaves the tab showing the last pull; it doesn't fail the sync.
      if (full) {
        try {
          await pullPlanned(db, client);
        } catch (err) {
          logLine('warn', `planned pull failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        // After the planned pull: a review reads its recurrence's planned currency from that cache.
        summary.recurringCreated = await pullUnreviewedRecurring(db, client, { since: lastSyncedAt });
      }

      if (replay.succeeded.length > 0 && await getBalancesStale(db)) {
        // A failure here must not turn a replay that landed into a failed sync; the flag stays
        // set, so the cash count waits for the next sync that manages the re-read.
        try {
          await pullAccountBalances(db, client);
          await setBalancesStale(db, false);
        } catch (err) {
          logLine('warn', `balance re-read after replay failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (replay.succeeded.length > 0) {
        await pullRecentTransactions(db, client, new Date().toISOString());
      }
    }

    // Independent of FF3 (brief §5.4: a draft can be parsed now and sent later) — a receipt
    // reader can be reachable while Firefly III is not.
    if (full) {
      summary.receiptsParsed = await retryPendingReceipts(db);
      await pruneUploadedReceiptImages(db);
    }

    if (full) {
      // Rebuild capture's payee/account history now, while nobody's waiting on it.
      await warmMerchantLookup(db).catch(() => undefined);
    }

    if (winner && full) {
      summary.lastSyncedAt = new Date().toISOString();
      await setLastSyncedAt(db, summary.lastSyncedAt);
    }
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
    logLine('error', `sync failed: ${summary.error}${err instanceof Error && err.stack ? `\n${err.stack}` : ''}`);
  }

  return summary;
}
