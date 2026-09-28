// What the transaction detail screen shows under "Receipt": photos still queued for upload (from
// the outbox) and the attachments FF3 already holds for that journal. Before this, attaching to a
// synced transaction gave no sign anywhere that anything had happened.
import type { FF3Client } from '../api/ff3/client';

export interface JournalAttachment {
  id: string;
  filename: string;
  /** Only set for an image FF3 can hand back — a PDF has nothing an <Image> can show. */
  imageSource: { uri: string; headers: Record<string, string> } | null;
}

export interface QueuedAttachment {
  opId: string;
  status: string;
  lastError: string | null;
  /** The local photo still waiting to upload, shown as the preview until FF3 has it. */
  receiptImagePath: string | null;
}

interface AttachmentRead {
  id: string;
  attributes: { filename?: string; title?: string | null; attachable_id?: string | number; mime?: string | null };
}

function isImage(a: AttachmentRead): boolean {
  if (a.attributes.mime) return a.attributes.mime.startsWith('image/');
  return /\.(jpe?g|png|webp|gif|heic)$/i.test(a.attributes.filename ?? '');
}

/** FF3's attachments for a group, narrowed to one journal (a split group has several). */
export async function fetchJournalAttachments(client: FF3Client, groupId: string, journalId: string): Promise<JournalAttachment[]> {
  const res = await client.request<{ data: AttachmentRead[] }>(`/v1/transactions/${encodeURIComponent(groupId)}/attachments`);
  return (res.data ?? [])
    .filter((a) => a.attributes.attachable_id == null || String(a.attributes.attachable_id) === journalId)
    .map((a) => ({
      id: a.id,
      filename: a.attributes.title || a.attributes.filename || `attachment ${a.id}`,
      imageSource: isImage(a) && client.imageSource ? client.imageSource(`/v1/attachments/${encodeURIComponent(a.id)}/download`) : null,
    }));
}

export interface ReceiptPreview {
  key: string;
  source: { uri: string; headers?: Record<string, string> };
}

/**
 * The transaction screen's receipt thumbnails. Photos still queued for upload come from the phone,
 * since FF3 doesn't have them yet. Everything else is what FF3 holds right now: the photo the
 * transaction was captured from is shown from the phone only while FF3's list isn't available
 * (loading, offline, failed). This used to assume that photo was FF3's first image and hide that
 * one instead of downloading it, so once the captured photo was deleted in FF3 the next upload was
 * hidden and the deleted photo stayed on screen.
 */
export function receiptPreviews(input: {
  queuedPaths: readonly string[];
  capturedPath: string | null;
  /** FF3's attachments for the journal; null or undefined when they couldn't be read. */
  remote: readonly JournalAttachment[] | null | undefined;
}): ReceiptPreview[] {
  const local = new Set(input.queuedPaths);
  if (!input.remote && input.capturedPath) local.add(input.capturedPath);
  return [
    ...[...local].map((uri) => ({ key: uri, source: { uri } })),
    ...(input.remote ?? []).flatMap((a) => (a.imageSource ? [{ key: a.id, source: a.imageSource }] : [])),
  ];
}

/** attach_receipt operations still in the outbox for this journal. */
export function queuedAttachments(
  outbox: { id: string; kind: string; status: string; payloadJson: string; lastError: string | null }[],
  journalId: string,
): QueuedAttachment[] {
  return outbox
    .filter((op) => op.kind === 'attach_receipt')
    .flatMap((op) => {
      let payload: { transactionJournalId?: string; receiptImagePath?: string };
      try {
        payload = JSON.parse(op.payloadJson);
      } catch {
        return [];
      }
      if (String(payload.transactionJournalId) !== journalId) return [];
      return [{ opId: op.id, status: op.status, lastError: op.lastError, receiptImagePath: payload.receiptImagePath ?? null }];
    });
}
