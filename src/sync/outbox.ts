// Outbox replay rules (brief §5.4):
// - Operations replay in strict `sequence` order, one at a time.
// - A create is safe to retry: it must include a client-generated id and
//   `error_if_duplicate_hash: true` so a retried request that already landed is recognized,
//   not duplicated.
// - An edit/delete compares the cached `updated_at` against the server's before sending; a
//   mismatch is a conflict, not an overwrite (Review Focus: conflicting edits).
// - A failure stops replay at that operation — later operations must not run out of order.
import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { FF3Client } from '../api/ff3/client';
import { FF3RequestError } from '../api/ff3/client';
import { outboxOperations, cachedTransactions, inboxItems } from '../db/schema';
import * as schema from '../db/schema';
import type { TransactionSplit, TransactionRead, AccountRead } from '../api/ff3/types';
import { generateId } from '../utils/id';
import { setEnvelopeMarker } from '../accounts/envelopeMarker';

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
  setEnvelopeMarker: boolean; // the desired on/off state; the notes text itself is read fresh at replay
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

export async function enqueueOperation(db: OutboxDb, op: NewOutboxOperation): Promise<void> {
  const existing = await db.select().from(outboxOperations);
  const nextSequence = existing.length === 0 ? 1 : Math.max(...existing.map((r: any) => r.sequence)) + 1;
  await db.insert(outboxOperations).values({
    id: op.id,
    inboxItemId: op.inboxItemId ?? null,
    kind: op.kind,
    payloadJson: JSON.stringify(op.payload),
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
    sequence: nextSequence,
  });
}

export async function replayOutbox(db: OutboxDb, client: FF3Client, opts: { onConflict?: ConflictHandler } = {}): Promise<ReplayResult> {
  const pending = (await db.select().from(outboxOperations))
    .filter((row: any) => row.status === 'pending' || row.status === 'failed')
    .sort((a: any, b: any) => a.sequence - b.sequence);

  const result: ReplayResult = { succeeded: [], conflicted: [], failedAt: null };

  for (const row of pending) {
    const payload = JSON.parse(row.payloadJson);
    try {
      if (row.kind === 'create_transaction') {
        const p = payload as CreateTransactionPayload;
        // Defect (3): the create response carries the group/journal ids nothing downstream can
        // work without — the confirmed→synced transition and the receipt attachment below both
        // need them, and without writing ff3GroupId a confirmed manual entry never leaves Inbox.
        const created = await client.request<{ data: TransactionRead }>('/v1/transactions', {
          method: 'POST',
          body: JSON.stringify({
            error_if_duplicate_hash: true,
            group_title: p.clientId,
            transactions: p.splits,
          }),
        });
        if (row.inboxItemId) {
          const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, row.inboxItemId));
          await db.update(inboxItems)
            .set({ ff3GroupId: created.data.id, state: 'synced', updatedAt: new Date().toISOString() })
            .where(eq(inboxItems.id, row.inboxItemId));

          const journal = created.data.attributes.transactions[0];
          if (item?.receiptImagePath && journal) {
            await enqueueOperation(db, {
              id: generateId(),
              inboxItemId: row.inboxItemId,
              kind: 'attach_receipt',
              payload: { transactionJournalId: journal.transaction_journal_id, receiptImagePath: item.receiptImagePath },
            });
          }
        }
      } else if (row.kind === 'attach_receipt') {
        const p = payload as AttachReceiptPayload;
        const created = await client.request<{ data: { id: string } }>('/v1/attachments', {
          method: 'POST',
          body: JSON.stringify({ filename: 'receipt.jpg', attachable_type: 'TransactionJournal', attachable_id: p.transactionJournalId }),
        });
        // Lazy require, not a module-scope import: this file is pulled into every outbox/inbox
        // test (see src/db/testDb.ts's header) and must stay safe to import under Jest, which
        // never reaches this branch. Loaded only when an attach_receipt op is actually replayed.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { File } = require('expo-file-system');
        const bytes: ArrayBuffer = await new File(p.receiptImagePath).arrayBuffer();
        await client.request(`/v1/attachments/${created.data.id}/upload`, {
          method: 'POST',
          body: bytes,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      } else if (row.kind === 'update_transaction' || row.kind === 'recurring_review') {
        const p = payload as UpdateTransactionPayload;
        const conflictAt = await conflictingUpdatedAt(db, p.groupId, p.expectedUpdatedAt);
        if (conflictAt) {
          result.conflicted.push(row.id);
          opts.onConflict?.({ id: row.id, payload: p }, conflictAt);
          await db.update(outboxOperations).set({ status: 'failed', lastError: 'conflict' }).where(eq(outboxOperations.id, row.id));
          result.failedAt = row.id;
          break;
        }
        await client.request(`/v1/transactions/${p.groupId}`, {
          method: 'PUT',
          body: JSON.stringify({ transactions: [{ transaction_journal_id: p.transactionJournalId, ...p.changes }] }),
        });
      } else if (row.kind === 'delete_transaction') {
        const p = payload as DeleteTransactionPayload;
        if (p.expectedUpdatedAt) {
          const conflictAt = await conflictingUpdatedAt(db, p.groupId, p.expectedUpdatedAt);
          if (conflictAt) {
            result.conflicted.push(row.id);
            opts.onConflict?.({ id: row.id, payload: p }, conflictAt);
            await db.update(outboxOperations).set({ status: 'failed', lastError: 'conflict' }).where(eq(outboxOperations.id, row.id));
            result.failedAt = row.id;
            break;
          }
        }
        await client.request(`/v1/transactions/${p.groupId}`, { method: 'DELETE' });
      } else if (row.kind === 'update_account') {
        // Read-modify-write at replay time, not a snapshot taken when the box was ticked: the
        // account's notes may have been edited in FF3's web UI meanwhile, and this must not
        // clobber it — only the mmyway-envelope line changes (design §6.6).
        const p = payload as UpdateAccountPayload;
        const current = await client.request<{ data: AccountRead }>(`/v1/accounts/${p.accountId}`);
        const currentNotes = (current.data.attributes as { notes?: string | null }).notes ?? null;
        await client.request(`/v1/accounts/${p.accountId}`, {
          method: 'PUT',
          body: JSON.stringify({ notes: setEnvelopeMarker(currentNotes, p.setEnvelopeMarker) }),
        });
      }

      await db.update(outboxOperations).set({ status: 'done' }).where(eq(outboxOperations.id, row.id));
      result.succeeded.push(row.id);
    } catch (err) {
      const message = err instanceof FF3RequestError ? `${err.status}: ${err.body}` : String(err);
      await db.update(outboxOperations)
        .set({ status: 'failed', attempts: row.attempts + 1, lastError: message })
        .where(eq(outboxOperations.id, row.id));
      result.failedAt = row.id;
      break; // Review Focus: never advance past a failed operation.
    }
  }

  return result;
}
