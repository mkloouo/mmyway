// What a queued change (an outbox operation) is about, for the Inbox's Queued and Needs attention
// cards: the thing it changes, by name, and the screen that shows it. Pure, no db — the names of
// accounts and cached transactions are passed in.
import type { OutboxKind, QueuedChangeInfo, QueuedChangeLookups } from '../sync/outboxTypes';
import { OUTBOX_KINDS } from '../sync/outboxKinds';
import { readPayload } from '../sync/payloadJson';

export type { QueuedChangeInfo, QueuedChangeLookups };

/** The ids of cached transactions the given operations point at, for the lookup query. */
export function referencedTransactions(ops: readonly { kind: OutboxKind; payloadJson: string }[]): {
  groupIds: string[];
  journalIds: string[];
} {
  const groupIds: string[] = [];
  const journalIds: string[] = [];
  for (const op of ops) {
    const p = safeRead(op.kind, op.payloadJson);
    if (!p) continue;
    if (typeof p.groupId === 'string') groupIds.push(p.groupId);
    if (
      (op.kind === 'attach_receipt' || op.kind === 'delete_attachment') &&
      typeof p.transactionJournalId === 'string'
    )
      journalIds.push(p.transactionJournalId);
  }
  return { groupIds, journalIds };
}

function safeRead(kind: OutboxKind, json: string): Record<string, unknown> | null {
  try {
    return readPayload(kind, json);
  } catch {
    return null;
  }
}

export function describeQueuedChange(
  op: { kind: OutboxKind; payloadJson: string; inboxItemId: string | null },
  lookups: QueuedChangeLookups,
): QueuedChangeInfo {
  const p = safeRead(op.kind, op.payloadJson);
  if (!p) return { subject: null, route: null, changed: [] };
  const spec = (OUTBOX_KINDS as Record<string, (typeof OUTBOX_KINDS)[keyof typeof OUTBOX_KINDS]>)[
    op.kind
  ];
  if (!spec) return { subject: null, route: null, changed: [] };
  return spec.describe(p, op, lookups);
}
