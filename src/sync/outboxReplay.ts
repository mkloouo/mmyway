// Outbox replay rules (brief §5.4):
// - Operations replay in strict `sequence` order, one at a time.
// - A create is safe to retry: it carries `internal_reference: mmyway:<clientId>` (part of FF3's
//   duplicate hash) and `error_if_duplicate_hash: true`, so a retried request that already
//   landed comes back as a duplicate of our own transaction and is recorded as a success.
// - An edit/delete compares `updated_at` — the cached one, then the server's own copy — before
//   sending; a mismatch is a conflict, not an overwrite (Review Focus: conflicting edits).
// - Each op is claimed (-> in_flight) just before it is sent; a finished op is deleted.
// - A failure holds back only the later operations that depend on it: the ones sharing a subject
//   (the same transaction, Inbox entry, account or planned transaction; src/sync/outboxSubjects.ts),
//   and in turn the ones depending on those. Unrelated operations go ahead (#41). A failure that
//   says FF3 can't be reached at all (no answer, 5xx, 401/403, 429) still stops the whole run, since
//   everything after it would fail the same way; so does an operation whose payload can't be read.
// - A failed op backs off (retryDelayMs): until its next_attempt_at it is not re-sent, and the
//   operations depending on it wait with it. "Retry now" in the Inbox sets it back to `pending`,
//   which skips the wait.
import { and, asc, eq } from 'drizzle-orm';
import { FF3RequestError, type FF3Client } from '../api/ff3/client';
import { outboxOperations } from '../db/schema';
import { describeFF3Error, serverUnavailable } from './outboxErrors';
import { OUTBOX_KINDS } from './outboxKinds';
import { OutboxBlocker, subjectsOf } from './outboxSubjects';
import type {
  ConflictHandler,
  KindSpec,
  OutboxDb,
  OutboxRow,
  ReplayOutcome,
  ReplayResult,
} from './outboxTypes';
import { readPayload } from './payloadJson';
import { isUnsent } from './unsent';

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60 * 1000;

/** How long a failed op waits before its next automatic retry: 30 s, doubling, at most an hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
}

// Replay order is strict: one op at a time, in sequence, and a failure stops the run so nothing
// is sent out of order. Each op is *claimed* (pending/failed -> in_flight) right before it is
// sent, re-reading it from the table: an op that Undo or Discard removed after this run started
// is skipped instead of sent, and two concurrent replays can never both send the same op.
export async function replayOutbox(
  db: OutboxDb,
  client: FF3Client,
  opts: { onConflict?: ConflictHandler } = {},
): Promise<ReplayResult> {
  const result: ReplayResult = { succeeded: [], conflicted: [], failedAt: null };
  const attempted = new Set<string>();
  const blocker = new OutboxBlocker();

  for (;;) {
    const pending = (
      await db
        .select()
        .from(outboxOperations)
        .where(isUnsent())
        .orderBy(asc(outboxOperations.sequence))
    ).filter((row) => !attempted.has(row.id));
    if (pending.length === 0) return result;

    for (const candidate of pending) {
      attempted.add(candidate.id);
      const subjects = subjectsOf(candidate);
      if (blocker.waits(subjects)) {
        blocker.block(subjects);
        if (blocker.blocksEverything) return result;
        continue;
      }
      if (
        candidate.status === 'failed' &&
        candidate.nextAttemptAt &&
        candidate.nextAttemptAt > new Date().toISOString()
      ) {
        result.failedAt ??= candidate.id;
        blocker.block(subjects);
        if (blocker.blocksEverything) return result;
        continue;
      }
      const [row] = await db
        .update(outboxOperations)
        .set({ status: 'in_flight' })
        .where(and(eq(outboxOperations.id, candidate.id), isUnsent()))
        .returning();
      if (!row) continue;

      const outcome = await replayOne(db, client, row, opts);
      if (outcome === 'done') {
        result.succeeded.push(row.id);
        continue;
      }
      if (outcome === 'returned') continue;
      if (outcome === 'conflict') result.conflicted.push(row.id);
      result.failedAt ??= row.id;
      if (outcome === 'unreachable') return result;
      blocker.block(subjects);
      if (blocker.blocksEverything) return result;
    }
  }
}

async function replayOne(
  db: OutboxDb,
  client: FF3Client,
  row: OutboxRow,
  opts: { onConflict?: ConflictHandler },
): Promise<ReplayOutcome> {
  const spec = (OUTBOX_KINDS as Record<string, KindSpec>)[row.kind];
  if (!spec) {
    throw new Error(`unknown outbox operation kind: ${row.kind}`);
  }
  try {
    const payload = readPayload(row.kind, row.payloadJson);
    return await spec.replay({ db, client, opts }, payload, row);
  } catch (err) {
    const message =
      err instanceof FF3RequestError
        ? describeFF3Error(err)
        : err instanceof Error
          ? err.message
          : String(err);
    await db
      .update(outboxOperations)
      .set({
        status: 'failed',
        attempts: row.attempts + 1,
        lastError: message,
        nextAttemptAt: new Date(Date.now() + retryDelayMs(row.attempts + 1)).toISOString(),
      })
      .where(eq(outboxOperations.id, row.id));
    return serverUnavailable(err) ? 'unreachable' : 'failed';
  }
}
