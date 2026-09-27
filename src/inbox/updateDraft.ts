import { eq } from 'drizzle-orm';
import { inboxItems, outboxOperations } from '../db/schema';
import type { Draft } from './draft';
import type { OutboxDb } from '../sync/outbox';
import { deletePersistedReceiptImage } from '../receipt/imageFiles';

const NOT_EDITABLE = new Set(['confirmed', 'synced']);

export async function updateDraft(db: OutboxDb, inboxItemId: string, patch: Partial<Draft>): Promise<void> {
  const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  const item = rows[0];
  if (!item) throw new Error(`inbox item ${inboxItemId} not found`);
  if (NOT_EDITABLE.has(item.state)) throw new Error(`cannot update inbox item ${inboxItemId}: already ${item.state}`);

  const draft: Draft = JSON.parse(item.draftJson);
  const merged: Draft = { ...draft, ...patch };
  await db.update(inboxItems)
    .set({ draftJson: JSON.stringify(merged), updatedAt: new Date().toISOString() })
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
