// What a queued change (an outbox operation) is about, for the Inbox's Queued and Needs attention
// cards: the thing it changes, by name, and the screen that shows it. Pure, no db — the names of
// accounts and cached transactions are passed in.
import type { Href } from 'expo-router';
import type { OutboxKind } from '../sync/outbox';
import { readPayload } from '../sync/payloadJson';

export interface QueuedChangeLookups {
  accountName: (id: string) => string | undefined;
  /** A cached transaction by its group id or (for a receipt upload) its journal id. */
  transaction: (ref: { groupId?: string; journalId?: string }) => { groupId: string; description: string } | undefined;
}

export interface QueuedChangeInfo {
  /** The transaction, account or planned transaction it changes; null when that can't be told. */
  subject: string | null;
  /** Where tapping the card goes; null when there's nothing left to open (a deleted planned one). */
  route: Href | null;
}

/** The ids of cached transactions the given operations point at, for the lookup query. */
export function referencedTransactions(ops: readonly { kind: OutboxKind; payloadJson: string }[]): { groupIds: string[]; journalIds: string[] } {
  const groupIds: string[] = [];
  const journalIds: string[] = [];
  for (const op of ops) {
    const p = safeRead(op.kind, op.payloadJson);
    if (!p) continue;
    if (typeof p.groupId === 'string') groupIds.push(p.groupId);
    if (op.kind === 'attach_receipt' && typeof p.transactionJournalId === 'string') journalIds.push(p.transactionJournalId);
  }
  return { groupIds, journalIds };
}

function safeRead(kind: OutboxKind, json: string): Record<string, unknown> | null {
  try { return readPayload(kind, json); } catch { return null; }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export function describeQueuedChange(
  op: { kind: OutboxKind; payloadJson: string; inboxItemId: string | null },
  lookups: QueuedChangeLookups,
): QueuedChangeInfo {
  const p = safeRead(op.kind, op.payloadJson);
  if (!p) return { subject: null, route: null };
  switch (op.kind) {
    case 'create_transaction': {
      const splits = (p.splits as { description?: unknown }[] | undefined) ?? [];
      return {
        subject: str(p.groupTitle) ?? str(splits[0]?.description),
        route: op.inboxItemId ? `/draft/${op.inboxItemId}` : null,
      };
    }
    case 'update_transaction':
    case 'delete_transaction':
    case 'recurring_review': {
      const groupId = p.groupId as string;
      const cached = lookups.transaction({ groupId });
      const changes = (p.changes as Record<string, unknown> | undefined) ?? {};
      return { subject: str(changes.description) ?? cached?.description ?? null, route: `/transactions/${groupId}` };
    }
    case 'attach_receipt': {
      const cached = lookups.transaction({ journalId: p.transactionJournalId as string });
      return { subject: cached?.description ?? null, route: cached ? `/transactions/${cached.groupId}` : null };
    }
    case 'update_account': {
      const id = p.accountId as string;
      const edit = (p.edit as Record<string, unknown> | undefined) ?? {};
      return { subject: str(edit.name) ?? lookups.accountName(id) ?? null, route: `/accounts/${id}` };
    }
    case 'save_planned': {
      const fields = p.fields as { name: string };
      return { subject: str(fields.name), route: `/planned/${encodeURIComponent(p.key as string)}` };
    }
    case 'delete_planned':
      return { subject: str(p.name), route: null };
  }
}
