import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import type { TransactionRead } from '../api/ff3/types';
import { cachedTransactions, inboxItems, outboxOperations } from '../db/schema';
import { returnedState, transition } from '../inbox/state';
import { deletePersistedReceiptImage } from '../receipt/imageFiles';
import { searchTransactions } from '../transactions/remoteSearch';
import { generateId } from '../utils/id';
import { internalReferenceFor, splitReference } from './outboxErrors';
import type {
  AttachReceiptPayload,
  CreateTransactionPayload,
  DeleteTransactionPayload,
  NewOutboxOperation,
  OutboxDb,
  OutboxRow,
  UpdateTransactionPayload,
} from './outboxTypes';
import { LEDGER_KINDS } from './outboxTypes';
import { affectsBalances } from './outboxLedger';
import { readPayload, tryReadPayload, writePayload } from './payloadJson';
import { cachedRowFromGroup } from './referenceData';
import { requestSync } from './syncTrigger';
import { isUnsent } from './unsent';

export { isUnsent };

export function insertOperation(db: OutboxDb, op: NewOutboxOperation): void {
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

/** A create that never left the device: nothing of it can be in FF3 (Undo may take it back). */
export const neverSent = () =>
  and(eq(outboxOperations.status, 'pending'), eq(outboxOperations.attempts, 0));

/**
 * Hands an inbox item back to the Inbox as a draft, in the caller's transaction: the create it
 * queued was taken back out or can't be sent. `errorMessage` says what to fix; without it the
 * item keeps whatever it had.
 */
export function returnToInbox(tx: OutboxDb, itemId: string, errorMessage?: string): void {
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
  const rows = await db
    .select({ kind: outboxOperations.kind, payloadJson: outboxOperations.payloadJson })
    .from(outboxOperations)
    .where(inArray(outboxOperations.kind, [...LEDGER_KINDS]));
  return rows.filter(affectsBalances).length;
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
    .set({ status: 'pending', attempts: sql`${outboxOperations.attempts} + 1` })
    .where(eq(outboxOperations.status, 'in_flight'));
}

/** "Retry now" on a failed operation: pending again, skipping its backoff. */
export async function retryOperationNow(db: OutboxDb, opId: string): Promise<void> {
  await db
    .update(outboxOperations)
    .set({ status: 'pending', lastError: null, nextAttemptAt: null })
    .where(and(eq(outboxOperations.id, opId), eq(outboxOperations.status, 'failed')));
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
 * A create that FF3 has: cache it, mark its inbox item synced, queue the receipt upload and drop the
 * op — one write, so a crash can't leave the item synced with the op still queued (or the reverse).
 * Shared by a replay that got the answer and a Cancel that found the transaction already there.
 */
export async function recordCreated(
  db: OutboxDb,
  row: OutboxRow,
  created: TransactionRead,
): Promise<void> {
  const item = row.inboxItemId
    ? (await db.select().from(inboxItems).where(eq(inboxItems.id, row.inboxItemId)))[0]
    : undefined;
  const journal = created?.attributes?.transactions?.[0];
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

/**
 * Whether FF3 already has the transaction a queued create was sending. A create that has been
 * attempted may have reached FF3 with only the answer lost, so removing it blindly leaves the
 * transaction there (and re-confirming an edited copy books it twice).
 */
export async function findLandedCreate(
  client: FF3Client,
  clientId: string,
): Promise<TransactionRead | null> {
  const reference = internalReferenceFor(clientId);
  const found = await searchTransactions(client, `internal_reference_is:"${reference}"`);
  return found.find((group) => splitReference(group) === reference) ?? null;
}

/** A create that has been attempted at least once: FF3 may hold it even though the app doesn't know. */
export function mayHaveLanded(op: { kind: string; attempts: number }): boolean {
  return op.kind === 'create_transaction' && op.attempts > 0;
}

/**
 * Drops a queued change before it is sent: the way out of one that can never succeed (a 422, an
 * account deleted in FF3, a receipt file that is gone), and the Queued card's Cancel. Nothing is
 * sent. An inbox item the operation was confirming goes back to the Inbox as a draft rather than
 * vanishing, so the entry itself is not lost.
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
  if (op?.kind === 'attach_receipt' && !op.inboxItemId) {
    const p = tryReadPayload<AttachReceiptPayload>(op.kind, op.payloadJson);
    deletePersistedReceiptImage(p?.receiptImagePath);
  }
  if (!op) {
    const [still] = await db
      .select({ id: outboxOperations.id })
      .from(outboxOperations)
      .where(eq(outboxOperations.id, opId));
    return still ? 'sending' : 'discarded';
  }
  return 'discarded';
}
