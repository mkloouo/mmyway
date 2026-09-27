// Receipt image files kept in documents/receipts/ — see src/receipt/ingest.ts for why.
import { generateId } from '../utils/id';

const RECEIPTS_DIR = 'receipts';

function extensionOf(uri: string): string {
  return /\.(jpe?g|png|webp|heic)$/i.exec(uri)?.[1]?.toLowerCase() ?? 'jpg';
}

/** Copies an image into documents/receipts/ and returns the new file:// uri. */
export function persistReceiptImage(sourceUri: string): string {
  // Lazy require: see outbox.ts's attach_receipt branch.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Directory, File, Paths } = require('expo-file-system');
  const dir = new Directory(Paths.document, RECEIPTS_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const target = new File(dir, `${generateId()}.${extensionOf(sourceUri)}`);
  new File(sourceUri).copy(target);
  return target.uri;
}

/** Deletes a receipt image this module persisted; leaves anything else (a gallery file) alone. */
export function deletePersistedReceiptImage(uri: string | null | undefined): void {
  if (!uri || !uri.includes(`/${RECEIPTS_DIR}/`)) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File } = require('expo-file-system');
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Best effort: a leftover file costs some storage, never correctness.
  }
}

