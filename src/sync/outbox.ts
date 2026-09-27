// Outbox replay rules (brief §5.4):
// - Operations replay in strict `sequence` order, one at a time.
// - A create is safe to retry: it carries `internal_reference: mmyway:<clientId>` (part of FF3's
//   duplicate hash) and `error_if_duplicate_hash: true`, so a retried request that already
//   landed comes back as a duplicate of our own transaction and is recorded as a success.
// - An edit/delete compares `updated_at` — the cached one, then the server's own copy — before
//   sending; a mismatch is a conflict, not an overwrite (Review Focus: conflicting edits).
// - Each op is claimed (-> in_flight) just before it is sent; a finished op is deleted.
// - A failure stops replay at that operation — later operations must not run out of order.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { FF3Client } from '../api/ff3/client';
import { FF3RequestError } from '../api/ff3/client';
import { outboxOperations, cachedTransactions, inboxItems } from '../db/schema';
import * as schema from '../db/schema';
import type { TransactionSplit, TransactionRead, AccountRead } from '../api/ff3/types';
import { generateId } from '../utils/id';
import { setEnvelopeMarker } from '../accounts/envelopeMarker';
import { requestSync } from './syncTrigger';
import { deletePersistedReceiptImage } from '../receipt/imageFiles';

export type OutboxKind =
  | 'create_transaction'
  | 'update_transaction'
  | 'delete_transaction'
  | 'attach_receipt'
  | 'recurring_review'
  | 'update_account';

export interface CreateTransactionPayload {
  clientId: string; // becomes the duplicate-hash guard
  splits: TransactionSplit[];
}

export interface UpdateTransactionPayload {
  groupId: string;
  transactionJournalId: string;
  expectedUpdatedAt: string; // conflict check
  changes: Partial<TransactionSplit>;
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
}

// Both the expo-sqlite and better-sqlite3 Drizzle instances (src/db/client.ts, src/db/testDb.ts)
// extend BaseSQLiteDatabase<'sync', ...> — only TRunResult differs, which nothing here touches.
export type OutboxDb = BaseSQLiteDatabase<'sync', any, typeof schema>;

export interface NewOutboxOperation {
  id: string;
  inboxItemId?: string;
  kind: OutboxKind;
  payload: CreateTransactionPayload | UpdateTransactionPayload | DeleteTransactionPayload | AttachReceiptPayload | UpdateAccountPayload | Record<string, unknown>;
}

export interface ReplayResult {
  succeeded: string[];
  conflicted: string[];
  failedAt: string | null; // operation id where replay stopped, if any
}

export type ConflictHandler = (op: { id: string; payload: UpdateTransactionPayload | DeleteTransactionPayload }, serverUpdatedAt: string) => void;

async function conflictingUpdatedAt(db: OutboxDb, groupId: string, expectedUpdatedAt: string): Promise<string | null> {
  const current = (await db.select().from(cachedTransactions).where(eq(cachedTransactions.groupId, groupId)))[0];
  return current && current.updatedAt !== expectedUpdatedAt ? current.updatedAt : null;
}

type ServerCopy = { status: 'present'; updatedAt: string | null } | { status: 'gone' };

// The cache check above is only as fresh as the last pull, and pulls only re-read a short
// window — an edit to an older transaction in FF3's web UI would never show up there. So an
// edit or delete also asks the server for its current copy right before sending.
async function serverCopy(client: FF3Client, groupId: string): Promise<ServerCopy> {
  try {
    const response = await client.request<{ data?: TransactionRead }>(`/v1/transactions/${groupId}`);
    const updatedAt = (response?.data?.attributes as { updated_at?: string } | undefined)?.updated_at ?? null;
    return { status: 'present', updatedAt };
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
  const split = group?.attributes.transactions[0] as { internal_reference?: string | null } | undefined;
  return split?.internal_reference ?? null;
}

// FF3 rejects a create whose hash matches an existing transaction with "Duplicate of transaction
// #N". Because internal_reference is in that hash, a duplicate carrying *our* reference can only be
// our own earlier attempt — one that reached the server but whose response was lost. That is a
// success to record, not a failure to retry forever. FF3 has named both the group and the journal
// id in that message across versions, so both lookups are tried.
async function recoverOwnDuplicate(client: FF3Client, id: string, reference: string): Promise<TransactionRead | null> {
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
  db.insert(outboxOperations).values({
    id: op.id,
    inboxItemId: op.inboxItemId ?? null,
    kind: op.kind,
    payloadJson: JSON.stringify(op.payload),
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
    sequence: sql`(select coalesce(max(${outboxOperations.sequence}), 0) + 1 from ${outboxOperations})`,
  }).run();
}

/**
 * Transaction-safe variant for callers that must write the op and their own state atomically
 * (confirmInboxItem, the create's follow-up writes). Pass the `tx` from `db.transaction`.
 */
export function enqueueOperationSync(tx: OutboxDb, op: NewOutboxOperation): void {
  insertOperation(tx, op);
}

export async function enqueueOperation(db: OutboxDb, op: NewOutboxOperation): Promise<void> {
  insertOperation(db, op);
  requestSync();
}

/**
 * A process killed mid-send leaves its op `in_flight`. Nothing in a fresh process owns it, so it
 * goes back to `pending`; creates are idempotent (see recoverOwnDuplicate) and edits are
 * re-checked against the server, so sending it again is safe. Call once per process, before the
 * first replay — never while one might be running.
 */
export async function recoverInFlight(db: OutboxDb): Promise<void> {
  await db.update(outboxOperations).set({ status: 'pending' }).where(eq(outboxOperations.status, 'in_flight'));
}

async function markConflict(db: OutboxDb, id: string): Promise<void> {
  await db.update(outboxOperations).set({ status: 'failed', lastError: 'conflict' }).where(eq(outboxOperations.id, id));
}

// After an edit lands, the server's updated_at moves on. A later queued edit or delete of the
// same transaction was conflict-checked against the old value — it would now conflict with the
// user's own previous edit. Rebase those onto the new value, and refresh the cache row.
async function rebaseLaterEdits(db: OutboxDb, groupId: string, previous: string, next: string | null): Promise<void> {
  if (!next || next === previous) return;
  await db.update(cachedTransactions).set({ updatedAt: next }).where(eq(cachedTransactions.groupId, groupId));
  const later = await db.select().from(outboxOperations)
    .where(and(inArray(outboxOperations.status, ['pending', 'failed']), inArray(outboxOperations.kind, ['update_transaction', 'recurring_review', 'delete_transaction'])));
  for (const op of later) {
    const payload = JSON.parse(op.payloadJson) as UpdateTransactionPayload | DeleteTransactionPayload;
    if (payload.groupId !== groupId || payload.expectedUpdatedAt !== previous) continue;
    payload.expectedUpdatedAt = next;
    await db.update(outboxOperations).set({ payloadJson: JSON.stringify(payload) }).where(eq(outboxOperations.id, op.id));
  }
}

// Replay order is strict: one op at a time, in sequence, and a failure stops the run so nothing
// is sent out of order. Each op is *claimed* (pending/failed -> in_flight) right before it is
// sent, re-reading it from the table: an op that Undo or Discard removed after this run started
// is skipped instead of sent, and two concurrent replays can never both send the same op.
export async function replayOutbox(db: OutboxDb, client: FF3Client, opts: { onConflict?: ConflictHandler } = {}): Promise<ReplayResult> {
  const result: ReplayResult = { succeeded: [], conflicted: [], failedAt: null };
  const attempted = new Set<string>();

  // Looped: a successful create can queue its receipt upload, which should go out in the same run.
  for (;;) {
    const pending = (await db.select().from(outboxOperations)
      .where(inArray(outboxOperations.status, ['pending', 'failed']))
      .orderBy(asc(outboxOperations.sequence)))
      .filter((row) => !attempted.has(row.id));
    if (pending.length === 0) return result;

    for (const candidate of pending) {
      attempted.add(candidate.id);
      const [row] = await db.update(outboxOperations)
        .set({ status: 'in_flight' })
        .where(and(eq(outboxOperations.id, candidate.id), inArray(outboxOperations.status, ['pending', 'failed'])))
        .returning();
      if (!row) continue; // undone, discarded, or claimed by someone else since the list was read

      const outcome = await replayOne(db, client, row, opts);
      if (outcome === 'done') {
        result.succeeded.push(row.id);
        continue;
      }
      if (outcome === 'conflict') result.conflicted.push(row.id);
      result.failedAt = row.id;
      return result; // never advance past a failed operation
    }
  }
}

type OutboxRow = typeof outboxOperations.$inferSelect;

async function replayOne(db: OutboxDb, client: FF3Client, row: OutboxRow, opts: { onConflict?: ConflictHandler }): Promise<'done' | 'conflict' | 'failed'> {
  const payload = JSON.parse(row.payloadJson);
  try {
    if (row.kind === 'create_transaction') {
      const p = payload as CreateTransactionPayload;
      const reference = internalReferenceFor(p.clientId);
      let created: TransactionRead;
      try {
        const response = await client.request<{ data: TransactionRead }>('/v1/transactions', {
          method: 'POST',
          body: JSON.stringify({
            error_if_duplicate_hash: true,
            transactions: p.splits.map((split) => ({ ...split, internal_reference: (split as { internal_reference?: string }).internal_reference ?? reference })),
          }),
        });
        created = response.data;
      } catch (err) {
        const duplicateId = duplicateOf(err);
        const recovered = duplicateId ? await recoverOwnDuplicate(client, duplicateId, reference) : null;
        if (!recovered) throw err;
        created = recovered;
      }

      // The create response carries the group/journal ids the confirmed -> synced transition and
      // the receipt upload both need. Written together with the op's removal, so a crash can't
      // leave the item synced with the op still queued (or the reverse).
      const item = row.inboxItemId
        ? (await db.select().from(inboxItems).where(eq(inboxItems.id, row.inboxItemId)))[0]
        : undefined;
      const journal = created?.attributes?.transactions?.[0];
      db.transaction((tx) => {
        if (row.inboxItemId) {
          tx.update(inboxItems)
            .set({ ff3GroupId: created?.id ?? null, state: 'synced', updatedAt: new Date().toISOString() })
            .where(eq(inboxItems.id, row.inboxItemId)).run();
          if (item?.receiptImagePath && journal) {
            insertOperation(tx, {
              id: generateId(),
              inboxItemId: row.inboxItemId,
              kind: 'attach_receipt',
              payload: { transactionJournalId: journal.transaction_journal_id, receiptImagePath: item.receiptImagePath },
            });
          }
        }
        tx.delete(outboxOperations).where(eq(outboxOperations.id, row.id)).run();
      });
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
          body: JSON.stringify({ filename: receiptFilename(p.receiptImagePath), attachable_type: 'TransactionJournal', attachable_id: p.transactionJournalId }),
        });
        attachmentId = created.data.id;
        await db.update(outboxOperations)
          .set({ payloadJson: JSON.stringify({ ...p, attachmentId }) })
          .where(eq(outboxOperations.id, row.id));
      }
      await client.request(`/v1/attachments/${attachmentId}/upload`, {
        method: 'POST',
        body: bytes,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
      // Uploaded: FF3 has the image now, so the device copy can go.
      if (row.inboxItemId) {
        await db.update(inboxItems).set({ receiptImagePath: null }).where(eq(inboxItems.id, row.inboxItemId));
      }
      deletePersistedReceiptImage(p.receiptImagePath);
      return 'done';
    }

    if (row.kind === 'update_transaction' || row.kind === 'recurring_review' || row.kind === 'delete_transaction') {
      const p = payload as UpdateTransactionPayload | DeleteTransactionPayload;
      const isDelete = row.kind === 'delete_transaction';
      if (p.expectedUpdatedAt) {
        const cachedConflict = await conflictingUpdatedAt(db, p.groupId, p.expectedUpdatedAt);
        if (cachedConflict) {
          opts.onConflict?.({ id: row.id, payload: p }, cachedConflict);
          await markConflict(db, row.id);
          return 'conflict';
        }
      }
      const server = await serverCopy(client, p.groupId);
      if (server.status === 'gone') {
        if (!isDelete) throw new Error('the transaction no longer exists in Firefly III');
        // Already deleted (in FF3, or by an earlier attempt of this op): the goal is reached.
        await db.delete(cachedTransactions).where(eq(cachedTransactions.groupId, p.groupId));
        await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
        return 'done';
      }
      if (p.expectedUpdatedAt && server.updatedAt && server.updatedAt !== p.expectedUpdatedAt) {
        await db.update(cachedTransactions).set({ updatedAt: server.updatedAt }).where(eq(cachedTransactions.groupId, p.groupId));
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
        const updated = await client.request<{ data?: TransactionRead }>(`/v1/transactions/${u.groupId}`, {
          method: 'PUT',
          body: JSON.stringify({ transactions: [{ transaction_journal_id: u.transactionJournalId, ...u.changes }] }),
        });
        const next = (updated?.data?.attributes as { updated_at?: string } | undefined)?.updated_at ?? null;
        if (u.expectedUpdatedAt) await rebaseLaterEdits(db, u.groupId, u.expectedUpdatedAt, next);
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
      const body: { notes?: string; active?: boolean } = {};
      if (p.setEnvelopeMarker !== undefined) {
        const current = await client.request<{ data: AccountRead }>(`/v1/accounts/${p.accountId}`);
        const currentNotes = (current.data.attributes as { notes?: string | null }).notes ?? null;
        body.notes = setEnvelopeMarker(currentNotes, p.setEnvelopeMarker);
      }
      if (p.active !== undefined) body.active = p.active;
      await client.request(`/v1/accounts/${p.accountId}`, { method: 'PUT', body: JSON.stringify(body) });
      await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
      return 'done';
    }

    throw new Error(`unknown outbox operation kind: ${row.kind}`);
  } catch (err) {
    const message = err instanceof FF3RequestError ? `${err.status}: ${err.body}` : err instanceof Error ? err.message : String(err);
    await db.update(outboxOperations)
      .set({ status: 'failed', attempts: row.attempts + 1, lastError: message })
      .where(eq(outboxOperations.id, row.id));
    return 'failed';
  }
}

function receiptFilename(path: string): string {
  const ext = /\.(jpe?g|png|webp|heic)$/i.exec(path)?.[1]?.toLowerCase();
  return `receipt.${ext === 'jpeg' ? 'jpg' : ext ?? 'jpg'}`;
}

/**
 * The user's way out of an operation that can never succeed (a 422, an account deleted in FF3, a
 * receipt file that is gone): replay stops at the first failure, so without this one bad
 * operation would hold back every later write forever. Local only — nothing is sent. An inbox
 * item the operation was confirming goes back to the Inbox as a draft rather than vanishing, so
 * the entry itself is not lost.
 */
export async function discardOperation(db: OutboxDb, opId: string): Promise<void> {
  const [op] = await db.select().from(outboxOperations).where(eq(outboxOperations.id, opId));
  if (!op) return;
  await db.delete(outboxOperations).where(eq(outboxOperations.id, opId));
  if (op.kind === 'create_transaction' && op.inboxItemId) {
    await db.update(inboxItems)
      .set({ state: 'captured', updatedAt: new Date().toISOString() })
      .where(eq(inboxItems.id, op.inboxItemId));
  }
}
