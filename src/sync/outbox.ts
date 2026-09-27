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
import { outboxOperations, cachedTransactions } from '../db/schema';
import * as schema from '../db/schema';
import type { TransactionSplit } from '../api/ff3/types';

export type OutboxKind =
  | 'create_transaction'
  | 'update_transaction'
  | 'delete_transaction'
  | 'attach_receipt'
  | 'recurring_review';

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
}

// Both the expo-sqlite and better-sqlite3 Drizzle instances (src/db/client.ts, src/db/testDb.ts)
// extend BaseSQLiteDatabase<'sync', ...> — only TRunResult differs, which nothing here touches.
export type OutboxDb = BaseSQLiteDatabase<'sync', any, typeof schema>;

export interface NewOutboxOperation {
  id: string;
  inboxItemId?: string;
  kind: OutboxKind;
  payload: CreateTransactionPayload | UpdateTransactionPayload | DeleteTransactionPayload | Record<string, unknown>;
}

export interface ReplayResult {
  succeeded: string[];
  conflicted: string[];
  failedAt: string | null; // operation id where replay stopped, if any
}

export type ConflictHandler = (op: { id: string; payload: UpdateTransactionPayload }, serverUpdatedAt: string) => void;

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
        await client.request('/v1/transactions', {
          method: 'POST',
          body: JSON.stringify({
            error_if_duplicate_hash: true,
            group_title: p.clientId,
            transactions: p.splits,
          }),
        });
      } else if (row.kind === 'update_transaction' || row.kind === 'recurring_review') {
        const p = payload as UpdateTransactionPayload;
        const current = (await db.select().from(cachedTransactions).where(eq(cachedTransactions.groupId, p.groupId)))[0];
        if (current && current.updatedAt !== p.expectedUpdatedAt) {
          result.conflicted.push(row.id);
          opts.onConflict?.({ id: row.id, payload: p }, current.updatedAt);
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
        await client.request(`/v1/transactions/${p.groupId}`, { method: 'DELETE' });
      }
      // attach_receipt follows the same try/advance/stop-on-failure shape; implemented in
      // Task 8 alongside the module that produces its payload.

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
