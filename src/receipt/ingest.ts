// The one capture path for a receipt image, whether it came from the camera, the gallery
// (app/receipt.tsx) or another app's share sheet (useSharedImages.ts).
//
// The picker and the share intent both hand over files in the app's *cache* directory, which
// Android may clear whenever storage runs low. The receipt upload (outbox attach_receipt) and the
// re-parse (retryPendingReceipts) read the file later — possibly days later, after an offline
// stretch — so the image is copied into the documents directory first (brief §5.4: keep the
// image until the upload succeeds) and deleted once it has been uploaded.
import * as Crypto from 'expo-crypto';
import { and, eq } from 'drizzle-orm';
import { transition } from '../inbox/state';
import { inboxItems } from '../db/schema';
import { findDuplicateReceiptItem, type Draft } from '../inbox/draft';
import { enqueueOperation, type OutboxDb } from '../sync/outbox';
import { generateId } from '../utils/id';
import { parseReceiptItem, type ParseOutcome } from './toDraft';
import { persistReceiptImage } from './imageFiles';
import { downscaleReceipt } from './downscale';
import { writeDraft } from '../inbox/draftJson';

type CaptureResult =
  | { kind: 'duplicate'; itemId: string }
  | { kind: 'created'; itemId: string; parse: Promise<ParseOutcome> };

/**
 * Dedupes by content hash, persists the image, inserts the `captured` inbox item and starts the
 * parse. `parse` is returned rather than awaited (the receipt screen doesn't wait for it at
 * all — the Inbox card carries on); it never rejects.
 */
export async function captureReceipt(
  db: OutboxDb,
  original: { uri: string; base64: string; hint?: string },
): Promise<CaptureResult> {
  const smaller = await downscaleReceipt(original.uri);
  const input = smaller ? { ...original, ...smaller } : original;
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input.base64);
  const duplicate = await findDuplicateReceiptItem(db, hash);
  if (duplicate) return { kind: 'duplicate', itemId: duplicate.id };

  // The same image again after it failed (no reader was set up, the model choked): retry that
  // item rather than adding a second card next to the error.
  const [errored] = await db
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.receiptContentHash, hash), eq(inboxItems.state, 'error')));
  if (errored) {
    await db
      .update(inboxItems)
      .set({
        state: transition('error', 'retry'),
        errorMessage: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(inboxItems.id, errored.id));
    const parse = parseReceiptItem(db, errored.id, input.base64, input.hint).catch(
      (): ParseOutcome => 'waiting',
    );
    return { kind: 'created', itemId: errored.id, parse };
  }

  const receiptImagePath = persistReceiptImage(input.uri);
  const id = generateId();
  const now = new Date().toISOString();
  const stub: Draft = {
    type: 'withdrawal',
    amount: '',
    currencyCode: '',
    date: now,
    description: '',
    isNewPayee: true,
  };
  await db.insert(inboxItems).values({
    id,
    kind: 'receipt',
    state: 'captured',
    draftJson: writeDraft(stub),
    receiptImagePath,
    receiptContentHash: hash,
    createdAt: now,
    updatedAt: now,
  });
  const parse = parseReceiptItem(db, id, input.base64, input.hint).catch(
    (): ParseOutcome => 'waiting',
  );
  return { kind: 'created', itemId: id, parse };
}

/** C2: attach a photo to an already-synced transaction — no inbox item, no parsing, just the upload. */
export async function attachReceiptToJournal(
  db: OutboxDb,
  input: { uri: string; transactionJournalId: string },
): Promise<void> {
  const receiptImagePath = persistReceiptImage(input.uri);
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'attach_receipt',
    payload: { transactionJournalId: input.transactionJournalId, receiptImagePath },
  });
}
