import { and, eq, ne } from 'drizzle-orm';
import { inboxItems, outboxOperations } from '../db/schema';
import type { Draft } from './draft';
import type { OutboxDb } from '../sync/outbox';
import { deletePersistedReceiptImage, persistReceiptImage } from '../receipt/imageFiles';
import { readDraft, writeDraft } from './draftJson';
import { transition } from './state';
import { unsureAfter } from './unsure';

const NOT_EDITABLE = new Set(['confirmed', 'synced']);

/** Retry on an errored item: back to its retry state; a receipt is re-read by the next sync. */
export async function retryErroredItem(db: OutboxDb, inboxItemId: string): Promise<void> {
  await db
    .update(inboxItems)
    .set({
      state: transition('error', 'retry'),
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(inboxItems.id, inboxItemId), eq(inboxItems.state, 'error')));
}

/** Gives an entry a receipt photo (copied out of the cache); it is uploaded once the transaction exists. */
export async function attachReceiptImage(
  db: OutboxDb,
  inboxItemId: string,
  uri: string,
): Promise<void> {
  await db
    .update(inboxItems)
    .set({ receiptImagePath: persistReceiptImage(uri), updatedAt: new Date().toISOString() })
    .where(eq(inboxItems.id, inboxItemId));
}

/**
 * Takes the photo off an entry and deletes the file (#69): the wrong receipt, a blurry shot, a
 * duplicate. A receipt draft keeps what was read from it — the fields are the user's to correct,
 * not the photo's to take back.
 */
export async function removeReceiptImage(db: OutboxDb, inboxItemId: string): Promise<void> {
  const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  if (!item) throw new Error(`inbox item ${inboxItemId} not found`);
  if (NOT_EDITABLE.has(item.state))
    throw new Error(`cannot update inbox item ${inboxItemId}: already ${item.state}`);
  await db
    .update(inboxItems)
    .set({ receiptImagePath: null, updatedAt: new Date().toISOString() })
    .where(eq(inboxItems.id, inboxItemId));
  if (item.receiptImagePath) {
    const [stillUsed] = await db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(
        and(eq(inboxItems.receiptImagePath, item.receiptImagePath), ne(inboxItems.id, inboxItemId)),
      )
      .limit(1);
    if (!stillUsed) {
      deletePersistedReceiptImage(item.receiptImagePath);
    }
  }
}

export async function updateDraft(
  db: OutboxDb,
  inboxItemId: string,
  patch: Partial<Draft>,
): Promise<void> {
  // Keep the read/merge/write synchronous: rapid field edits and Confirm must see the latest
  // saved draft, rather than overwriting one another after an awaited read.
  db.transaction((tx) => {
    const [item] = tx.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId)).all();
    if (!item) throw new Error(`inbox item ${inboxItemId} not found`);
    if (NOT_EDITABLE.has(item.state))
      throw new Error(`cannot update inbox item ${inboxItemId}: already ${item.state}`);

    const draft = readDraft(item.draftJson);
    const merged: Draft = { ...draft, ...patch };
    // A field the reader wasn't sure about stops being marked once the user sets it.
    if (!('lowConfidenceFields' in patch)) merged.lowConfidenceFields = unsureAfter(draft, patch);
    tx.update(inboxItems)
      .set({
        draftJson: writeDraft(merged),
        // Once the user starts correcting a receipt, a later model result or retry must not
        // overwrite it. Manual captures keep their original state.
        state: item.kind === 'receipt' && item.state === 'captured' ? 'parsed' : item.state,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(inboxItems.id, inboxItemId))
      .run();
  });
}

// Local-only removal: deletes the inbox row and any outbox ops still pointing at it, so a
// captured/errored item that never should have synced doesn't leave an orphaned outbox op
// behind. Does not touch FF3 — an already-`synced` item's real transaction stays put; delete it
// from the transaction list (app/transactions/[groupId].tsx) instead.
export async function deleteInboxItem(db: OutboxDb, inboxItemId: string): Promise<void> {
  const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  await db.delete(outboxOperations).where(eq(outboxOperations.inboxItemId, inboxItemId));
  await db.delete(inboxItems).where(eq(inboxItems.id, inboxItemId));
  if (item?.receiptImagePath) {
    const [stillUsed] = await db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(eq(inboxItems.receiptImagePath, item.receiptImagePath))
      .limit(1);
    if (!stillUsed) {
      deletePersistedReceiptImage(item.receiptImagePath);
    }
  }
}
