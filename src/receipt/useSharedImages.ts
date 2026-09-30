// S4 (design §6.8): a screenshot or order confirmation shared from another app lands in the
// same pipeline as a photo. Mounted once in app/_layout.tsx, not per-screen.
import { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useDb } from '../providers/DbProvider';
import { readReceiptImageBase64 } from './toDraft';
import { captureReceipt } from './ingest';
import { logLine } from '../utils/log';
import type { OutboxDb } from '../sync/outbox';
import { errorMessage } from '../utils/errorMessage';

export interface SharedImageFile {
  path: string;
  mimeType: string;
}

/**
 * Routes one shared image through the same capture path as the camera (src/receipt/ingest.ts):
 * dedupe by content hash, keep the image, insert the inbox item, land on the Inbox, parse.
 */
export async function ingestSharedImage(db: OutboxDb, file: SharedImageFile): Promise<void> {
  if (!file.mimeType.startsWith('image/')) return;
  const base64 = await readReceiptImageBase64(file.path);
  const result = await captureReceipt(db, { uri: file.path, base64 });
  if (result.kind === 'duplicate') {
    router.replace(`/draft/${result.itemId}`);
    return;
  }
  router.replace('/');
  await result.parse;
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
    void (async () => {
      try {
        for (const file of files) {
          try {
            await ingestSharedImage(db, file);
          } catch (err) {
            // One unreadable file must not wedge the share target: `processing` used to stay
            // true forever and every later share was ignored until a restart.
            logLine('error', `shared image ${file.path}: ${errorMessage(err)}`);
          }
        }
      } finally {
        resetShareIntent();
        processing.current = false;
      }
    })();
  }, [hasShareIntent, shareIntent, db, resetShareIntent]);
}
