import { eq } from 'drizzle-orm';
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
    .where(eq(inboxItems.id, inboxItemId));
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
  deletePersistedReceiptImage(item.receiptImagePath);
}

export async function updateDraft(
  db: OutboxDb,
  inboxItemId: string,
  patch: Partial<Draft>,
): Promise<void> {
  const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  const item = rows[0];
  if (!item) throw new Error(`inbox item ${inboxItemId} not found`);
  if (NOT_EDITABLE.has(item.state))
    throw new Error(`cannot update inbox item ${inboxItemId}: already ${item.state}`);

  const draft = readDraft(item.draftJson);
  const merged: Draft = { ...draft, ...patch };
  // A field the reader wasn't sure about stops being marked once the user sets it.
  if (!('lowConfidenceFields' in patch)) merged.lowConfidenceFields = unsureAfter(draft, patch);
  await db
    .update(inboxItems)
    .set({ draftJson: writeDraft(merged), updatedAt: new Date().toISOString() })
    .where(eq(inboxItems.id, inboxItemId));
}

// Local-only removal: deletes the inbox row and any outbox ops still pointing at it, so a
// captured/errored item that never should have synced doesn't leave an orphaned outbox op
// behind. Does not touch FF3 — an already-`synced` item's real transaction stays put; delete it
// from the transaction list (app/transactions/[groupId].tsx) instead.
export async function deleteInboxItem(db: OutboxDb, inboxItemId: string): Promise<void> {
  const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  await db.delete(outboxOperations).where(eq(outboxOperations.inboxItemId, inboxItemId));
  await db.delete(inboxItems).where(eq(inboxItems.id, inboxItemId));
  deletePersistedReceiptImage(item?.receiptImagePath);
}
