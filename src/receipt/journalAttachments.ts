// What the transaction detail screen shows under "Receipt": photos still queued for upload (from
// the outbox) and the attachments FF3 already holds for that journal. Before this, attaching to a
// synced transaction gave no sign anywhere that anything had happened.
import type { FF3Client } from '../api/ff3/client';

export interface JournalAttachment {
  id: string;
  filename: string;
}

export interface QueuedAttachment {
  opId: string;
  status: string;
  lastError: string | null;
}

interface AttachmentRead {
  id: string;
  attributes: { filename?: string; title?: string | null; attachable_id?: string | number };
}

/** FF3's attachments for a group, narrowed to one journal (a split group has several). */
export async function fetchJournalAttachments(client: FF3Client, groupId: string, journalId: string): Promise<JournalAttachment[]> {
  const res = await client.request<{ data: AttachmentRead[] }>(`/v1/transactions/${encodeURIComponent(groupId)}/attachments`);
  return (res.data ?? [])
    .filter((a) => a.attributes.attachable_id == null || String(a.attributes.attachable_id) === journalId)
    .map((a) => ({ id: a.id, filename: a.attributes.title || a.attributes.filename || `attachment ${a.id}` }));
}

/** attach_receipt operations still in the outbox for this journal. */
export function queuedAttachments(
  outbox: { id: string; kind: string; status: string; payloadJson: string; lastError: string | null }[],
  journalId: string,
): QueuedAttachment[] {
  return outbox
    .filter((op) => op.kind === 'attach_receipt')
    .filter((op) => {
      try {
        return String((JSON.parse(op.payloadJson) as { transactionJournalId?: string }).transactionJournalId) === journalId;
      } catch {
        return false;
      }
    })
    .map((op) => ({ opId: op.id, status: op.status, lastError: op.lastError }));
}
