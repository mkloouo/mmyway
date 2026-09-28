// FF3 attachment images, downloaded into the cache and shown from there. Handing the download URL
// and a Bearer header straight to <Image> showed grey placeholders and a black full-screen view for
// photos FF3's web UI opens fine: the image loader fails silently, so there was nothing to go on.
// A download through expo-file-system sends the same headers as every other API call and reports
// what went wrong, which lands in the Diagnostics log.
import { logLine } from '../utils/log';

const CACHE_DIR = 'ff3-attachments';

/** A local file:// uri for the attachment, downloading it the first time. */
export async function attachmentFile(attachmentId: string, source: { uri: string; headers: Record<string, string> }): Promise<string> {
  // Lazy require: see outbox.ts's attach_receipt branch.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Directory, File, Paths } = require('expo-file-system');
  const dir = new Directory(Paths.cache, CACHE_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  // Attachment ids are never reused in FF3, so a file already here is this attachment.
  const file = new File(dir, attachmentId.replace(/[^\w-]/g, '_'));
  if (file.exists && file.size > 0) return file.uri;
  try {
    const downloaded = await File.downloadFileAsync(source.uri, file, { headers: source.headers, idempotent: true });
    return downloaded.uri;
  } catch (err) {
    logLine('error', `attachment ${attachmentId} download failed: ${err instanceof Error ? err.message : String(err)}`);
    if (file.exists) file.delete();
    throw err;
  }
}
