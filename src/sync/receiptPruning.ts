import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { inboxItems, outboxOperations } from '../db/schema';
import { deletePersistedReceiptImage } from '../receipt/imageFiles';
import type { OutboxDb } from './outboxTypes';
import { tryReadPayload } from './payloadJson';

export function receiptFilename(path: string): string {
  const ext = /\.(jpe?g|png|webp|heic)$/i.exec(path)?.[1]?.toLowerCase();
  return `receipt.${ext === 'jpeg' ? 'jpg' : (ext ?? 'jpg')}`;
}

/** How long a receipt photo stays on the device after its transaction synced. */
export const KEEP_UPLOADED_RECEIPTS_DAYS = 30;

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
  const queued = await db.select().from(outboxOperations);
  const pendingItems = new Set(queued.map((op) => op.inboxItemId));
  const pendingPaths = new Set(
    queued
      .filter((op) => op.kind === 'attach_receipt')
      .map(
        (op) =>
          tryReadPayload<{ receiptImagePath: string }>(op.kind, op.payloadJson)?.receiptImagePath,
      ),
  );
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
    if (pendingItems.has(item.id) || pendingPaths.has(item.path!)) continue;
    await db.update(inboxItems).set({ receiptImagePath: null }).where(eq(inboxItems.id, item.id));
    // One exchange receipt can produce several drafts sharing this file. Releasing one old
    // reference must not delete the photo another draft still needs to parse or upload.
    const [stillUsed] = db
      .select({ id: inboxItems.id })
      .from(inboxItems)
      .where(eq(inboxItems.receiptImagePath, item.path!))
      .limit(1)
      .all();
    if (!stillUsed) deletePersistedReceiptImage(item.path);
  }
}
