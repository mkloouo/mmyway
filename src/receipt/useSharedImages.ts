// S4 (design §6.8): a screenshot or order confirmation shared from another app lands in the
// same pipeline as a photo. Mounted once in app/_layout.tsx, not per-screen.
import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import * as Crypto from 'expo-crypto';
import { useDb } from '../providers/DbProvider';
import { inboxItems } from '../db/schema';
import { findDuplicateReceiptItem } from '../inbox/draft';
import { parseReceiptItem, readReceiptImageBase64 } from './toDraft';
import { generateId } from '../utils/id';
import type { Draft } from '../inbox/draft';
import type { OutboxDb } from '../sync/outbox';

export interface SharedImageFile {
  path: string;
  mimeType: string;
}

/**
 * Routes one shared image through the existing capture path: dedupe by content hash, insert the
 * inbox item, land on the Inbox, then keep parsing in the background — the same shape as
 * app/receipt.tsx's `capture()`, minus the camera/gallery picker.
 */
export async function ingestSharedImage(db: OutboxDb, file: SharedImageFile): Promise<void> {
  if (!file.mimeType.startsWith('image/')) return;

  const base64 = await readReceiptImageBase64(file.path);
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);

  const duplicate = await findDuplicateReceiptItem(db, hash);
  if (duplicate) {
    router.replace(`/draft/${duplicate.id}`);
    return;
  }

  const id = generateId();
  const now = new Date().toISOString();
  const stub: Draft = { type: 'withdrawal', amount: '', currencyCode: '', date: now, description: '', isNewPayee: true };
  await db.insert(inboxItems).values({
    id, kind: 'receipt', state: 'captured', draftJson: JSON.stringify(stub),
    receiptImagePath: file.path, receiptContentHash: hash,
    createdAt: now, updatedAt: now,
  });
  router.replace('/');
  await parseReceiptItem(db, id, base64);
}

export function useSharedImages(): void {
  const db = useDb();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const processing = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || processing.current) return;
    const files = (shareIntent.files ?? []).filter((f) => f.mimeType.startsWith('image/'));
    if (files.length === 0) {
      resetShareIntent();
      return;
    }
    processing.current = true;
    (async () => {
      for (const file of files) await ingestSharedImage(db, file);
      resetShareIntent();
      processing.current = false;
    })();
  }, [hasShareIntent, shareIntent, db, resetShareIntent]);
}
