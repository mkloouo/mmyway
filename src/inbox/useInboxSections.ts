// The Inbox's three sections (design §6.1): the list only ever holds unfinished work.
// `confirmed`/`synced` items leave every section — they show up in Activity instead.
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';
import { inboxItems, outboxOperations } from '../db/schema';

export type InboxItemRow = typeof inboxItems.$inferSelect;
export type OutboxOperationRow = typeof outboxOperations.$inferSelect;

export type AttentionItem =
  | { kind: 'inbox_error'; id: string; item: InboxItemRow }
  | { kind: 'outbox_failed'; id: string; op: OutboxOperationRow };

export interface InboxSections {
  needsAttention: AttentionItem[];
  toConfirm: InboxItemRow[];
  toReview: InboxItemRow[];
  actionableCount: number;
}

const TO_CONFIRM_KINDS = new Set(['manual_entry', 'receipt']);
const TO_CONFIRM_STATES = new Set(['captured', 'parsed']);

export function useInboxSections(): InboxSections {
  const db = useDb();
  const { data: items } = useLiveQuery(db.select().from(inboxItems));
  const { data: outbox } = useLiveQuery(db.select().from(outboxOperations).where(eq(outboxOperations.status, 'failed')));

  const rows = items ?? [];
  const opRows = outbox ?? [];

  const toConfirm = rows.filter((row) => TO_CONFIRM_KINDS.has(row.kind) && TO_CONFIRM_STATES.has(row.state));
  const toReview = rows.filter((row) => row.kind === 'recurring_review' && row.state === 'confirmed');
  const needsAttention: AttentionItem[] = [
    ...rows.filter((row) => row.state === 'error').map((item): AttentionItem => ({ kind: 'inbox_error', id: item.id, item })),
    ...opRows.map((op): AttentionItem => ({ kind: 'outbox_failed', id: op.id, op })),
  ];

  return {
    needsAttention,
    toConfirm,
    toReview,
    actionableCount: needsAttention.length + toConfirm.length + toReview.length,
  };
}
