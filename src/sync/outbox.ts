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
import { and, asc, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { FF3Client } from '../api/ff3/client';
import type { EditChanges } from '../transactions/editDiff';
import { FF3RequestError, UPLOAD_TIMEOUT_MS } from '../api/ff3/client';
import { searchTransactions } from '../transactions/remoteSearch';
import { outboxOperations, cachedTransactions, inboxItems } from '../db/schema';
import * as schema from '../db/schema';
import type { TransactionSplit, TransactionRead, AccountRead } from '../api/ff3/types';
import { generateId } from '../utils/id';
import { setEnvelopeMarker } from '../accounts/envelopeMarker';
import { ff3AccountBody, type AccountEdit } from '../accounts/accountEdit';
import { requestSync } from './syncTrigger';
import { returnedState, transition } from '../inbox/state';
import { deletePersistedReceiptImage } from '../receipt/imageFiles';
import { cachedRowFromGroup } from './referenceData';
import { readPayload, writePayload } from './payloadJson';
import { OutboxBlocker, subjectsOf } from './outboxSubjects';
import { accountResolver, withAccountIds } from './accountIds';
import {
  replayDeletePlanned,
  replaySavePlanned,
  type DeletePlannedPayload,
  type SavePlannedPayload,
} from '../planned/replay';

export type OutboxKind =
  | 'create_transaction'
  | 'update_transaction'
  | 'delete_transaction'
  | 'attach_receipt'
  | 'recurring_review'
  | 'update_account'
  | 'save_planned'
  | 'delete_planned';

/** The kinds that change an account balance in FF3 once they land; receipts and account edits don't. */
export const LEDGER_KINDS = [
  'create_transaction',
  'update_transaction',
  'delete_transaction',
  'recurring_review',
] as const satisfies readonly OutboxKind[];

export interface CreateTransactionPayload {
  clientId: string; // becomes the duplicate-hash guard
  splits: TransactionSplit[];
  groupTitle?: string; // FF3 requires one when there is more than one split
}

export interface UpdateTransactionPayload {
  groupId: string;
  transactionJournalId: string;
  expectedUpdatedAt: string; // conflict check
  changes: EditChanges;
  /**
   * A split transaction's edit: every split, in order, as it should be afterwards. FF3 updates the
   * splits that carry a transaction_journal_id and creates the ones without. `changes` then only
   * summarises it (total, title) for Activity and the conflict screen.
   */
  splits?: (Partial<TransactionSplit> & { transaction_journal_id?: string })[];
  groupTitle?: string;
  /** Splits the user removed: deleted one by one after the update (a PUT doesn't remove them). */
  removedJournalIds?: string[];
  /** Set once the update itself has landed, so a retry only redoes the split deletes. */
  applied?: boolean;
}

export interface DeleteTransactionPayload {
  groupId: string;
  expectedUpdatedAt?: string; // conflict check, same as update_transaction; optional for callers that skip it
}

export interface AttachReceiptPayload {
  transactionJournalId: string;
  receiptImagePath: string; // file:// uri; read lazily at replay time, never held in memory across app restarts
}

export interface UpdateAccountPayload {
  accountId: string;
  setEnvelopeMarker?: boolean; // the desired on/off state; the notes text itself is read fresh at replay
  active?: boolean; // FF3's account `active` flag
  order?: number; // FF3's account `order` (position among the user's asset accounts)
  edit?: AccountEdit; // the account page's changed fields (src/accounts/accountEdit.ts)
}

// Both the expo-sqlite and better-sqlite3 Drizzle instances (src/db/client.ts, src/db/testDb.ts)
// extend BaseSQLiteDatabase<'sync', ...> — only TRunResult differs, which nothing here touches.
export type OutboxDb = BaseSQLiteDatabase<'sync', any, typeof schema>;

export interface NewOutboxOperation {
  id: string;
  inboxItemId?: string;
  kind: OutboxKind;
  payload:
    | CreateTransactionPayload
    | UpdateTransactionPayload
    | DeleteTransactionPayload
    | AttachReceiptPayload
    | UpdateAccountPayload
    | SavePlannedPayload
    | DeletePlannedPayload
    | Record<string, unknown>;
}

interface ReplayResult {
  succeeded: string[];
  conflicted: string[];
  failedAt: string | null; // operation id where replay stopped, if any
}

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60 * 1000;

/** How long a failed op waits before its next automatic retry: 30 s, doubling, at most an hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
}

type ConflictHandler = (
  op: { id: string; payload: UpdateTransactionPayload | DeleteTransactionPayload },
  serverUpdatedAt: string,
) => void;

async function conflictingUpdatedAt(
  db: OutboxDb,
  groupId: string,
  expectedUpdatedAt: string,
): Promise<string | null> {
  const current = (
    await db.select().from(cachedTransactions).where(eq(cachedTransactions.groupId, groupId))
  )[0];
  return current && current.updatedAt !== expectedUpdatedAt ? current.updatedAt : null;
}

type ServerCopy =
  | { status: 'present'; updatedAt: string | null; group: TransactionRead | null }
  | { status: 'gone' };

// The cache check above is only as fresh as the last pull, and pulls only re-read a short
// window — an edit to an older transaction in FF3's web UI would never show up there. So an
// edit or delete also asks the server for its current copy right before sending.
async function serverCopy(client: FF3Client, groupId: string): Promise<ServerCopy> {
  try {
    const response = await client.request<{ data?: TransactionRead }>(
      `/v1/transactions/${groupId}`,
    );
    const updatedAt =
      (response?.data?.attributes as { updated_at?: string } | undefined)?.updated_at ?? null;
    return { status: 'present', updatedAt, group: response?.data ?? null };
  } catch (err) {
    if (err instanceof FF3RequestError && err.status === 404) return { status: 'gone' };
    throw err;
  }
}

/** The idempotency key sent with every create; part of FF3's duplicate hash, unlike group_title. */
export function internalReferenceFor(clientId: string): string {
  return `mmyway:${clientId}`;
}

function duplicateOf(err: unknown): string | null {
  if (!(err instanceof FF3RequestError) || err.status !== 422) return null;
  return /Duplicate of transaction #(\d+)/.exec(err.body)?.[1] ?? null;
}

function splitReference(group: TransactionRead | undefined): string | null {
  const split = group?.attributes.transactions[0] as
    { internal_reference?: string | null } | undefined;
  return split?.internal_reference ?? null;
}

// FF3 rejects a create whose hash matches an existing transaction with "Duplicate of transaction
// #N". Because internal_reference is in that hash, a duplicate carrying *our* reference can only be
// our own earlier attempt — one that reached the server but whose response was lost. That is a
// success to record, not a failure to retry forever. FF3 has named both the group and the journal
// id in that message across versions, so both lookups are tried.
async function recoverOwnDuplicate(
  client: FF3Client,
  id: string,
  reference: string,
): Promise<TransactionRead | null> {
  for (const path of [`/v1/transactions/${id}`, `/v1/transaction-journals/${id}`]) {
    try {
      const found = await client.request<{ data: TransactionRead }>(path);
      if (splitReference(found?.data) === reference) return found.data;
    } catch (err) {
      if (!(err instanceof FF3RequestError && err.status === 404)) throw err;
    }
  }
  return null;
}

function insertOperation(db: OutboxDb, op: NewOutboxOperation): void {
  // The sequence is computed inside the INSERT itself: a read-then-write from JS let two enqueues
  // interleave across an await and take the same number.
  db.insert(outboxOperations)
    .values({
      id: op.id,
      inboxItemId: op.inboxItemId ?? null,
      kind: op.kind,
      payloadJson: writePayload(op.payload),
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
      sequence: sql`(select coalesce(max(${outboxOperations.sequence}), 0) + 1 from ${outboxOperations})`,
    })
    .run();
}

/**
 * Transaction-safe variant for callers that must write the op and their own state atomically
 * (confirmInboxItem, the create's follow-up writes). Pass the `tx` from `db.transaction`.
 */
/**
 * An operation that hasn't gone out: replay may claim it and Cancel may drop it. `in_flight` is on
 * its way and left alone; `done` rows are deleted, not kept. Every "is it still queued?" question
 * asks through this (#79).
 */
const UNSENT_STATUSES = ['pending', 'failed'] as const;
export const isUnsent = () => inArray(outboxOperations.status, [...UNSENT_STATUSES]);

/** A create that never left the device: nothing of it can be in FF3 (Undo may take it back). */
export const neverSent = () =>
  and(eq(outboxOperations.status, 'pending'), eq(outboxOperations.attempts, 0));

/**
 * Hands an inbox item back to the Inbox as a draft, in the caller's transaction: the create it
 * queued was taken back out or can't be sent. `errorMessage` says what to fix; without it the
 * item keeps whatever it had.
 */
function returnToInbox(tx: OutboxDb, itemId: string, errorMessage?: string): void {
  const [item] = tx
    .select({ kind: inboxItems.kind })
    .from(inboxItems)
    .where(eq(inboxItems.id, itemId))
    .all();
  tx.update(inboxItems)
    .set({
      state: returnedState(item?.kind ?? 'manual_entry'),
      ...(errorMessage === undefined ? {} : { errorMessage }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(inboxItems.id, itemId))
    .run();
}

export function enqueueOperationSync(tx: OutboxDb, op: NewOutboxOperation): void {
  insertOperation(tx, op);
}

export async function enqueueOperation(db: OutboxDb, op: NewOutboxOperation): Promise<void> {
  insertOperation(db, op);
  requestSync();
}

/** Queued operations (in any status) that will change a balance in FF3 when they land. */
export async function queuedLedgerOpCount(db: OutboxDb): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(outboxOperations)
    .where(inArray(outboxOperations.kind, [...LEDGER_KINDS]));
  return Number(row?.n ?? 0);
}

/**
 * A process killed mid-send leaves its op `in_flight`. Nothing in a fresh process owns it, so it
 * goes back to `pending`; creates are idempotent (see recoverOwnDuplicate) and edits are
 * re-checked against the server, so sending it again is safe. Call once per process, before the
 * first replay — never while one might be running.
 */
export async function recoverInFlight(db: OutboxDb): Promise<void> {
  await db
    .update(outboxOperations)
    .set({ status: 'pending' })
    .where(eq(outboxOperations.status, 'in_flight'));
}

async function markConflict(db: OutboxDb, id: string): Promise<void> {
  await db
    .update(outboxOperations)
    .set({ status: 'failed', lastError: 'conflict' })
    .where(eq(outboxOperations.id, id));
}

// After an edit lands, the server's updated_at moves on. A later queued edit or delete of the
// same transaction was conflict-checked against the old value — it would now conflict with the
// user's own previous edit. Rebase those onto the new value, and refresh the cache row.
async function rebaseLaterEdits(
  db: OutboxDb,
  groupId: string,
  previous: string,
  next: string | null,
): Promise<void> {
  if (!next || next === previous) return;
  await db
    .update(cachedTransactions)
    .set({ updatedAt: next })
    .where(eq(cachedTransactions.groupId, groupId));
  const later = await db
    .select()
    .from(outboxOperations)
    .where(
      and(
        isUnsent(),
        inArray(outboxOperations.kind, [
          'update_transaction',
          'recurring_review',
          'delete_transaction',
        ]),
      ),
    );
  for (const op of later) {
    const payload = readPayload<UpdateTransactionPayload | DeleteTransactionPayload>(
      op.kind,
      op.payloadJson,
    );
    if (payload.groupId !== groupId || payload.expectedUpdatedAt !== previous) continue;
    payload.expectedUpdatedAt = next;
    await db
      .update(outboxOperations)
      .set({ payloadJson: writePayload(payload) })
      .where(eq(outboxOperations.id, op.id));
  }
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

  // Looped: a successful create can queue its receipt upload, which should go out in the same run.
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
        blocker.block(subjects); // waits behind a failure, so whatever depends on it waits too
        if (blocker.blocksEverything) return result;
        continue;
      }
      if (
        candidate.status === 'failed' &&
        candidate.nextAttemptAt &&
        candidate.nextAttemptAt > new Date().toISOString()
      ) {
        // Still backing off: not re-sent, and what depends on it waits with it.
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
      if (!row) continue; // undone, discarded, or claimed by someone else since the list was read

      const outcome = await replayOne(db, client, row, opts);
      if (outcome === 'done') {
        result.succeeded.push(row.id);
        continue;
      }
      if (outcome === 'returned') continue; // back in the Inbox for the user; not a failure
      if (outcome === 'conflict') result.conflicted.push(row.id);
      result.failedAt ??= row.id;
      // FF3 unreachable: everything after would fail the same way, and back off for nothing.
      if (outcome === 'unreachable') return result;
      blocker.block(subjects);
      if (blocker.blocksEverything) return result;
    }
  }
}

type OutboxRow = typeof outboxOperations.$inferSelect;

/** An edited transaction's type, for a partial change naming an account without saying it. */
async function cachedTypeOf(
  db: OutboxDb,
  groupId: string,
): Promise<'withdrawal' | 'deposit' | 'transfer' | undefined> {
  const [row] = await db
    .select({ type: cachedTransactions.type })
    .from(cachedTransactions)
    .where(eq(cachedTransactions.groupId, groupId));
  return row?.type === 'withdrawal' || row?.type === 'deposit' || row?.type === 'transfer'
    ? row.type
    : undefined;
}

/**
 * What a queued create points at that FF3 no longer has, per the last reference pull: an account,
 * a category or a budget deleted there since the entry was confirmed. A reference table that is
 * empty (never synced) proves nothing and is skipped.
 */
async function missingReferences(db: OutboxDb, splits: TransactionSplit[]): Promise<string[]> {
  const [accounts, categories, budgets] = await Promise.all([
    db.select({ id: schema.referenceAccounts.id }).from(schema.referenceAccounts),
    db.select({ name: schema.referenceCategories.name }).from(schema.referenceCategories),
    db.select({ id: schema.referenceBudgets.id }).from(schema.referenceBudgets),
  ]);
  const accountIds = new Set(accounts.map((a) => a.id));
  const categoryNames = new Set(categories.map((c) => c.name.toLowerCase()));
  const budgetIds = new Set(budgets.map((b) => b.id));
  const problems: string[] = [];
  for (const split of splits) {
    for (const [end, id] of [
      ['source', split.source_id],
      ['destination', split.destination_id],
    ] as const) {
      if (id && accountIds.size > 0 && !accountIds.has(String(id)))
        problems.push(`The ${end} account no longer exists in Firefly III — pick another.`);
    }
    if (
      split.category_name &&
      categoryNames.size > 0 &&
      !categoryNames.has(split.category_name.toLowerCase())
    ) {
      problems.push(
        `The category "${split.category_name}" no longer exists in Firefly III — pick another.`,
      );
    }
    if (split.budget_id && budgetIds.size > 0 && !budgetIds.has(String(split.budget_id)))
      problems.push('The budget no longer exists in Firefly III — pick another.');
  }
  return problems;
}

/**
 * A create that FF3 has: cache it, mark its inbox item synced, queue the receipt upload and drop the
 * op — one write, so a crash can't leave the item synced with the op still queued (or the reverse).
 * Shared by a replay that got the answer and a Cancel that found the transaction already there.
 */
async function recordCreated(
  db: OutboxDb,
  row: OutboxRow,
  created: TransactionRead,
): Promise<void> {
  // The create response carries the group/journal ids the confirmed -> synced transition and
  // the receipt upload both need. Written together with the op's removal, so a crash can't
  // leave the item synced with the op still queued (or the reverse).
  const item = row.inboxItemId
    ? (await db.select().from(inboxItems).where(eq(inboxItems.id, row.inboxItemId)))[0]
    : undefined;
  const journal = created?.attributes?.transactions?.[0];
  // FF3's answer is the transaction as it now is: cached in the same write that removes the
  // op, so Activity swaps the queued row for the synced one without it vanishing until the
  // next pull. An answer missing a field the cache requires is left for that pull instead.
  const synced = created ? cachedRowFromGroup(created, new Date().toISOString()) : null;
  const cacheable =
    !!synced &&
    [synced.amount, synced.currencyCode, synced.date, synced.type, synced.journalId].every(
      (v) => typeof v === 'string' && v !== '',
    );
  db.transaction((tx) => {
    if (synced && cacheable) {
      tx.insert(cachedTransactions)
        .values(synced)
        .onConflictDoUpdate({ target: cachedTransactions.groupId, set: synced })
        .run();
    }
    if (row.inboxItemId) {
      tx.update(inboxItems)
        .set({
          ff3GroupId: created?.id ?? null,
          state: transition('confirmed', 'synced'),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(inboxItems.id, row.inboxItemId))
        .run();
      if (item?.receiptImagePath && journal) {
        insertOperation(tx, {
          id: generateId(),
          inboxItemId: row.inboxItemId,
          kind: 'attach_receipt',
          payload: {
            transactionJournalId: journal.transaction_journal_id,
            receiptImagePath: item.receiptImagePath,
          },
        });
      }
    }
    tx.delete(outboxOperations).where(eq(outboxOperations.id, row.id)).run();
  });
}

async function replayOne(
  db: OutboxDb,
  client: FF3Client,
  row: OutboxRow,
  opts: { onConflict?: ConflictHandler },
): Promise<'done' | 'conflict' | 'failed' | 'unreachable' | 'returned'> {
  let payload: unknown;
  try {
    payload = readPayload(row.kind, row.payloadJson);
    if (row.kind === 'create_transaction') {
      const p = payload as CreateTransactionPayload;
      const missing = await missingReferences(db, p.splits);
      if (missing.length > 0 && row.inboxItemId) {
        // Sending it anyway either fails (a deleted account: a 422 that blocks the queue) or
        // quietly re-creates the thing (FF3 makes a new category from an unknown name). Hand the
        // entry back as a draft that says what to pick again; the rest of the queue carries on.
        db.transaction((tx) => {
          returnToInbox(tx, row.inboxItemId!, missing.join(' '));
          tx.delete(outboxOperations).where(eq(outboxOperations.id, row.id)).run();
        });
        return 'returned';
      }
      const reference = internalReferenceFor(p.clientId);
      const resolve = accountResolver(client);
      const splits: TransactionSplit[] = [];
      for (const split of p.splits) splits.push(await withAccountIds(resolve, split));
      let created: TransactionRead;
      try {
        const response = await client.request<{ data: TransactionRead }>('/v1/transactions', {
          method: 'POST',
          body: JSON.stringify({
            error_if_duplicate_hash: true,
            ...(p.groupTitle ? { group_title: p.groupTitle } : {}),
            transactions: splits.map((split) => ({
              ...split,
              internal_reference:
                (split as { internal_reference?: string }).internal_reference ?? reference,
            })),
          }),
        });
        created = response.data;
      } catch (err) {
        const duplicateId = duplicateOf(err);
        const recovered = duplicateId
          ? await recoverOwnDuplicate(client, duplicateId, reference)
          : null;
        if (!recovered) throw err;
        created = recovered;
      }

      await recordCreated(db, row, created);
      return 'done';
    }

    if (row.kind === 'attach_receipt') {
      const p = payload as AttachReceiptPayload;
      // Lazy require, not a module-scope import: this file is pulled into every outbox/inbox
      // test (see src/db/testDb.ts's header) and must stay safe to import under Jest.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { File } = require('expo-file-system');
      const file = new File(p.receiptImagePath);
      if (!file.exists) throw new Error(`receipt image is missing: ${p.receiptImagePath}`);
      const bytes: ArrayBuffer = await file.arrayBuffer();
      // Record the attachment id before uploading, so a failed upload retries the upload alone
      // instead of creating another empty attachment in FF3.
      let attachmentId = (payload as { attachmentId?: string }).attachmentId;
      if (!attachmentId) {
        const created = await client.request<{ data: { id: string } }>('/v1/attachments', {
          method: 'POST',
          body: JSON.stringify({
            filename: receiptFilename(p.receiptImagePath),
            attachable_type: 'TransactionJournal',
            attachable_id: p.transactionJournalId,
          }),
        });
        attachmentId = created.data.id;
        await db
          .update(outboxOperations)
          .set({ payloadJson: writePayload({ ...p, attachmentId }) })
          .where(eq(outboxOperations.id, row.id));
      }
      await client.request(`/v1/attachments/${attachmentId}/upload`, {
        method: 'POST',
        body: bytes,
        headers: { 'Content-Type': 'application/octet-stream' },
        timeoutMs: UPLOAD_TIMEOUT_MS,
      });
      await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
      // The device copy stays for a while after upload so the draft can still show it;
      // pruneUploadedReceiptImages removes it later. An image attached to an already-synced
      // transaction (no inbox item) has nothing to show it, so that one goes now.
      if (!row.inboxItemId) deletePersistedReceiptImage(p.receiptImagePath);
      return 'done';
    }

    if (
      row.kind === 'update_transaction' ||
      row.kind === 'recurring_review' ||
      row.kind === 'delete_transaction'
    ) {
      const p = payload as UpdateTransactionPayload | DeleteTransactionPayload;
      const isDelete = row.kind === 'delete_transaction';
      // A split edit whose update already landed only has its split deletes left: the server's
      // copy has moved on by our own hand, so checking it again would call that a conflict.
      const resumed = !isDelete && !!(p as UpdateTransactionPayload).applied;
      if (p.expectedUpdatedAt && !resumed) {
        const cachedConflict = await conflictingUpdatedAt(db, p.groupId, p.expectedUpdatedAt);
        if (cachedConflict) {
          opts.onConflict?.({ id: row.id, payload: p }, cachedConflict);
          await markConflict(db, row.id);
          return 'conflict';
        }
      }
      const server: ServerCopy = resumed
        ? { status: 'present', updatedAt: null, group: null }
        : await serverCopy(client, p.groupId);
      if (server.status === 'gone') {
        if (!isDelete) throw new Error('the transaction no longer exists in Firefly III');
        // Already deleted (in FF3, or by an earlier attempt of this op): the goal is reached.
        await db.delete(cachedTransactions).where(eq(cachedTransactions.groupId, p.groupId));
        await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
        return 'done';
      }
      if (p.expectedUpdatedAt && server.updatedAt && server.updatedAt !== p.expectedUpdatedAt) {
        // Store the server's whole current copy, not just its timestamp: the conflict screen
        // compares it field by field with the queued change, and a stale cached row made both
        // sides look the same.
        const fresh = server.group
          ? cachedRowFromGroup(server.group, new Date().toISOString())
          : null;
        try {
          if (!fresh) throw new Error('no server copy to store');
          await db
            .insert(cachedTransactions)
            .values(fresh)
            .onConflictDoUpdate({ target: cachedTransactions.groupId, set: fresh });
        } catch {
          // An incomplete copy (a field the cache requires is missing) must not turn a conflict
          // into a failure — keep at least the new timestamp.
          await db
            .update(cachedTransactions)
            .set({ updatedAt: server.updatedAt })
            .where(eq(cachedTransactions.groupId, p.groupId));
        }
        opts.onConflict?.({ id: row.id, payload: p }, server.updatedAt);
        await markConflict(db, row.id);
        return 'conflict';
      }

      if (isDelete) {
        await client.request(`/v1/transactions/${p.groupId}`, { method: 'DELETE' });
        // Nothing else removes it: pulls only upsert, so a deleted transaction would otherwise
        // stay in Activity and in payee history forever.
        await db.delete(cachedTransactions).where(eq(cachedTransactions.groupId, p.groupId));
      } else {
        const u = p as UpdateTransactionPayload;
        let updated: { data?: TransactionRead } | null = null;
        if (!u.applied) {
          const resolve = accountResolver(client);
          const groupType = await cachedTypeOf(db, u.groupId);
          const transactions = [];
          for (const split of u.splits ?? [
            { transaction_journal_id: u.transactionJournalId, ...u.changes },
          ]) {
            // FF3 rejects a note of length 0; edits queued before that was known still carry ''.
            const cleaned = split.notes === '' ? { ...split, notes: null } : split;
            transactions.push(await withAccountIds(resolve, cleaned, groupType));
          }
          const body = u.splits
            ? { ...(u.groupTitle !== undefined ? { group_title: u.groupTitle } : {}), transactions }
            : { transactions };
          updated = await client.request<{ data?: TransactionRead }>(
            `/v1/transactions/${u.groupId}`,
            {
              method: 'PUT',
              body: JSON.stringify(body),
            },
          );
        }
        if (!u.applied && u.removedJournalIds?.length) {
          // Recorded before the deletes, so a failure in them retries only them.
          const landed = (updated?.data?.attributes as { updated_at?: string } | undefined)
            ?.updated_at;
          if (u.expectedUpdatedAt && landed)
            await rebaseLaterEdits(db, u.groupId, u.expectedUpdatedAt, landed);
          const progressed: UpdateTransactionPayload = {
            ...u,
            applied: true,
            expectedUpdatedAt: landed ?? u.expectedUpdatedAt,
          };
          await db
            .update(outboxOperations)
            .set({ payloadJson: writePayload(progressed) })
            .where(eq(outboxOperations.id, row.id));
          Object.assign(u, progressed);
        }
        for (const journalId of u.removedJournalIds ?? []) {
          try {
            await client.request(`/v1/transaction-journals/${journalId}`, { method: 'DELETE' });
          } catch (err) {
            // Already gone (an earlier attempt, or FF3's web UI): that's the goal.
            if (!(err instanceof FF3RequestError && err.status === 404)) throw err;
          }
        }
        const final = u.removedJournalIds?.length
          ? await client.request<{ data?: TransactionRead }>(`/v1/transactions/${u.groupId}`)
          : updated;
        const next =
          (final?.data?.attributes as { updated_at?: string } | undefined)?.updated_at ?? null;
        if (u.expectedUpdatedAt) await rebaseLaterEdits(db, u.groupId, u.expectedUpdatedAt, next);
        // A split edit adds, removes and re-numbers splits: the cached row takes FF3's answer at
        // once, so the detail screen doesn't show the old splits until the next pull.
        const fresh =
          u.splits && final?.data ? cachedRowFromGroup(final.data, new Date().toISOString()) : null;
        if (fresh)
          await db
            .insert(cachedTransactions)
            .values(fresh)
            .onConflictDoUpdate({ target: cachedTransactions.groupId, set: fresh });
      }
      await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
      return 'done';
    }

    if (row.kind === 'update_account') {
      // Only the fields this operation carries are sent. The envelope marker is a
      // read-modify-write at replay time, not a snapshot taken when the box was ticked: the
      // account's notes may have been edited in FF3's web UI meanwhile, and this must not clobber
      // it — only the mmyway-envelope line changes (design §6.6).
      const p = payload as UpdateAccountPayload;
      const body: Record<string, unknown> = p.edit ? ff3AccountBody(p.edit) : {};
      if (p.setEnvelopeMarker !== undefined) {
        const current = await client.request<{ data: AccountRead }>(`/v1/accounts/${p.accountId}`);
        const currentNotes = (current.data.attributes as { notes?: string | null }).notes ?? null;
        body.notes = setEnvelopeMarker(currentNotes, p.setEnvelopeMarker);
      }
      if (p.active !== undefined) body.active = p.active;
      if (p.order !== undefined) body.order = p.order;
      await client.request(`/v1/accounts/${p.accountId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
      return 'done';
    }

    if (row.kind === 'save_planned') {
      await replaySavePlanned(db, client, row.id, payload as SavePlannedPayload);
      await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
      return 'done';
    }

    if (row.kind === 'delete_planned') {
      await replayDeletePlanned(db, client, payload as DeletePlannedPayload);
      await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
      return 'done';
    }

    throw new Error(`unknown outbox operation kind: ${row.kind}`);
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

/**
 * A failure that isn't about this operation: FF3 didn't answer, is failing itself, refuses the
 * token, or is rate limiting. Anything else (a 4xx about this request, a conflict, bad data) is
 * the operation's own.
 */
export function serverUnavailable(err: unknown): boolean {
  if (err instanceof FF3RequestError) {
    return err.status >= 500 || err.status === 401 || err.status === 403 || err.status === 429;
  }
  // fetch rejects with a TypeError when there was no answer, and an AbortError on a timeout.
  return err instanceof TypeError || (err instanceof Error && err.name === 'AbortError');
}

/**
 * What the Inbox's failed-operation card shows: FF3's own message and first field error instead of
 * the raw JSON body (`401: {"message":"Unauthenticated.","exception":…}`).
 *
 * @public Exported for outbox.regressions.test.ts, which loads it with `requireActual`.
 */
export function describeFF3Error(err: FF3RequestError): string {
  // Which call, and which fields FF3 named: a planned save makes three calls, and "The notes must
  // be at least 1 characters" alone didn't say which of them refused it.
  const where = (fields: string[]) =>
    err.request ? ` — ${err.request}${fields.length ? ` (${fields.join(', ')})` : ''}` : '';
  try {
    const body = JSON.parse(err.body) as { message?: string; errors?: Record<string, string[]> };
    const field = body.errors ? Object.values(body.errors).flat()[0] : undefined;
    const text = [body.message, field]
      .filter((part, i, all) => !!part && all.indexOf(part) === i)
      .join(' — ');
    if (text) return `${text} (${err.status})${where(Object.keys(body.errors ?? {}))}`;
  } catch {
    // not JSON: an HTML error page or empty body
  }
  return err.body && err.body.length < 200 && !err.body.trimStart().startsWith('<')
    ? `${err.body} (${err.status})${where([])}`
    : `Firefly III answered ${err.status}${where([])}`;
}

function receiptFilename(path: string): string {
  const ext = /\.(jpe?g|png|webp|heic)$/i.exec(path)?.[1]?.toLowerCase();
  return `receipt.${ext === 'jpeg' ? 'jpg' : (ext ?? 'jpg')}`;
}

/** "Retry now" on a failed operation: pending again, skipping its backoff. */
export async function retryOperationNow(db: OutboxDb, opId: string): Promise<void> {
  await db
    .update(outboxOperations)
    .set({ status: 'pending', lastError: null, nextAttemptAt: null })
    .where(eq(outboxOperations.id, opId));
}

/**
 * The conflict screen's "Keep mine": the queued edit or delete is re-checked against the server
 * copy the user just looked at, and goes out again over it.
 */
export async function keepMineOverServer(
  db: OutboxDb,
  opId: string,
  serverUpdatedAt: string,
): Promise<void> {
  const [op] = await db.select().from(outboxOperations).where(eq(outboxOperations.id, opId));
  if (!op) return;
  const payload = readPayload<UpdateTransactionPayload | DeleteTransactionPayload>(
    op.kind,
    op.payloadJson,
  );
  payload.expectedUpdatedAt = serverUpdatedAt;
  await db
    .update(outboxOperations)
    .set({
      status: 'pending',
      payloadJson: writePayload(payload),
      lastError: null,
      nextAttemptAt: null,
    })
    .where(eq(outboxOperations.id, opId));
}

/** The conflict screen's "Use the server's": the queued change is dropped. */
export async function dropQueuedChange(db: OutboxDb, opId: string): Promise<void> {
  await db.delete(outboxOperations).where(eq(outboxOperations.id, opId));
}

/**
 * Queues a conflict-checked delete for each cached transaction (Activity's multi-select delete).
 */
export async function deleteCachedTransactions(db: OutboxDb, groupIds: string[]): Promise<void> {
  const rows = await db
    .select({ groupId: cachedTransactions.groupId, updatedAt: cachedTransactions.updatedAt })
    .from(cachedTransactions)
    .where(inArray(cachedTransactions.groupId, groupIds));
  for (const row of rows) {
    await enqueueOperation(db, {
      id: generateId(),
      kind: 'delete_transaction',
      payload: { groupId: row.groupId, expectedUpdatedAt: row.updatedAt },
    });
  }
}

/**
 * Whether FF3 already has the transaction a queued create was sending. A create that has been
 * attempted may have reached FF3 with only the answer lost, so removing it blindly leaves the
 * transaction there (and re-confirming an edited copy books it twice).
 */
async function findLandedCreate(
  client: FF3Client,
  clientId: string,
): Promise<TransactionRead | null> {
  const reference = internalReferenceFor(clientId);
  const found = await searchTransactions(client, `internal_reference_is:"${reference}"`);
  return found.find((group) => splitReference(group) === reference) ?? null;
}

/**
 * Drops a queued change before it is sent: the way out of one that can never succeed (a 422, an
 * account deleted in FF3, a receipt file that is gone), and the Queued card's Cancel. Nothing is
 * sent. An inbox item the operation was confirming goes back to the Inbox as a draft rather than
 * vanishing, so the entry itself is not lost.
 *
 * - 'sending': the change is already on its way, and left alone.
 * - A create that was already attempted is looked up in FF3 first: 'landed' when it is there (it
 *   is recorded as synced instead), 'unreachable' when FF3 can't say, so it stays queued.
 */
export async function discardOperation(
  db: OutboxDb,
  opId: string,
  resolveClient: () => Promise<FF3Client | null> = async () => null,
): Promise<'discarded' | 'sending' | 'landed' | 'unreachable'> {
  const [queued] = await db.select().from(outboxOperations).where(eq(outboxOperations.id, opId));
  if (queued && queued.status !== 'in_flight' && mayHaveLanded(queued)) {
    const clientId = (readPayload(queued.kind, queued.payloadJson) as CreateTransactionPayload)
      .clientId;
    let landed: TransactionRead | null;
    try {
      const client = await resolveClient();
      if (!client) return 'unreachable';
      landed = await findLandedCreate(client, clientId);
    } catch {
      return 'unreachable';
    }
    if (landed) {
      await recordCreated(db, queued, landed);
      return 'landed';
    }
  }
  const op = db.transaction((tx) => {
    const [dropped] = tx
      .delete(outboxOperations)
      .where(and(eq(outboxOperations.id, opId), ne(outboxOperations.status, 'in_flight')))
      .returning()
      .all();
    if (dropped?.kind === 'create_transaction' && dropped.inboxItemId)
      returnToInbox(tx, dropped.inboxItemId);
    return dropped;
  });
  if (!op) {
    const [still] = await db
      .select({ id: outboxOperations.id })
      .from(outboxOperations)
      .where(eq(outboxOperations.id, opId));
    return still ? 'sending' : 'discarded';
  }
  return 'discarded';
}

/** A create that has been attempted at least once: FF3 may hold it even though the app doesn't know. */
export function mayHaveLanded(op: { kind: string; attempts: number }): boolean {
  return op.kind === 'create_transaction' && op.attempts > 0;
}

/** How long a receipt photo stays on the device after its transaction synced. */
const KEEP_UPLOADED_RECEIPTS_DAYS = 30;

/**
 * Frees the space of receipt photos whose transaction synced over a month ago (about a
 * megabyte each, several a day). Only for items with no queued upload left, so nothing FF3
 * still needs is removed.
 */
export async function pruneUploadedReceiptImages(
  db: OutboxDb,
  now: Date = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - KEEP_UPLOADED_RECEIPTS_DAYS * 86_400_000).toISOString();
  const old = await db
    .select({ id: inboxItems.id, path: inboxItems.receiptImagePath })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.state, 'synced'),
        isNotNull(inboxItems.receiptImagePath),
        lt(inboxItems.updatedAt, cutoff),
      ),
    );
  for (const item of old) {
    const [queued] = await db
      .select({ id: outboxOperations.id })
      .from(outboxOperations)
      .where(eq(outboxOperations.inboxItemId, item.id))
      .limit(1);
    if (queued) continue;
    deletePersistedReceiptImage(item.path);
    await db.update(inboxItems).set({ receiptImagePath: null }).where(eq(inboxItems.id, item.id));
  }
}
