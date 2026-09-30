// The Inbox's sections (design §6.1): the list only ever holds unfinished work.
// `confirmed`/`synced` items leave every section — they show up in Activity instead. Changes still
// waiting to reach FF3 are listed under Queued, every kind of them, until they're sent.
import { useMemo } from 'react';
import { asc, inArray, or } from 'drizzle-orm';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';
import { cachedTransactions, inboxItems, outboxOperations, referenceAccounts } from '../db/schema';
import {
  describeQueuedChange,
  referencedTransactions,
  type QueuedChangeInfo,
} from './queuedChanges';
import { readDraft } from './draftJson';
import { draftReadiness, type DraftReadiness } from './readiness';
import type { Draft } from './draft';

export type InboxItemRow = typeof inboxItems.$inferSelect;
export type OutboxOperationRow = typeof outboxOperations.$inferSelect;

export type AttentionItem =
  | { kind: 'inbox_error'; id: string; item: InboxItemRow }
  | { kind: 'outbox_failed'; id: string; op: OutboxOperationRow; info: QueuedChangeInfo };

export interface QueuedChange {
  id: string;
  op: OutboxOperationRow;
  info: QueuedChangeInfo;
}

/**
 * A to-confirm row with its draft parsed once. The Inbox re-renders on every live-query update,
 * and the parse plus the readiness rule used to run per item in three places on each of them.
 */
export interface ConfirmEntry {
  id: string;
  item: InboxItemRow;
  /** null while a receipt is still being read — there is no draft to show yet. */
  draft: Draft | null;
  readiness: DraftReadiness | null;
  /** Past the receipt-reading state and ready: what Confirm all and multi-select act on. */
  confirmable: boolean;
}

export interface InboxSections {
  needsAttention: AttentionItem[];
  toConfirm: ConfirmEntry[];
  toReview: InboxItemRow[];
  queued: QueuedChange[];
  actionableCount: number;
}

const TO_CONFIRM_KINDS = new Set(['manual_entry', 'receipt']);
const TO_CONFIRM_STATES = new Set(['captured', 'parsed']);

/**
 * `enabled: false` is for the Inbox while a screen is open over it (a draft, Capture): it stays
 * mounted underneath, and every write the screen on top made re-read the tables and re-rendered
 * the list nobody could see. It keeps what it had and catches up when enabled again.
 */
export function useInboxSections({ enabled = true }: { enabled?: boolean } = {}): InboxSections {
  const db = useDb();
  const { data: items } = useLiveQuery(db.select().from(inboxItems), [], enabled);
  const { data: outbox } = useLiveQuery(
    db
      .select()
      .from(outboxOperations)
      .where(inArray(outboxOperations.status, ['pending', 'in_flight', 'failed']))
      .orderBy(asc(outboxOperations.sequence)),
    [],
    enabled,
  );
  const { data: accounts } = useLiveQuery(
    db.select({ id: referenceAccounts.id, name: referenceAccounts.name }).from(referenceAccounts),
    [],
    enabled,
  );

  // Only the cached transactions the queue points at, not the whole table.
  const refs = useMemo(() => referencedTransactions(outbox ?? []), [outbox]);
  const refsKey = `${refs.groupIds.join(',')}|${refs.journalIds.join(',')}`;
  const { data: txs } = useLiveQuery(
    db
      .select({
        groupId: cachedTransactions.groupId,
        journalId: cachedTransactions.journalId,
        description: cachedTransactions.description,
      })
      .from(cachedTransactions)
      .where(
        or(
          inArray(cachedTransactions.groupId, refs.groupIds),
          inArray(cachedTransactions.journalId, refs.journalIds),
        ),
      ),
    [refsKey],
    enabled,
  );

  return useMemo(() => {
    const rows = items ?? [];
    const accountNames = new Map((accounts ?? []).map((a) => [a.id, a.name]));
    const txList = txs ?? [];
    const lookups = {
      accountName: (id: string) => accountNames.get(id),
      transaction: (ref: { groupId?: string; journalId?: string }) =>
        txList.find((t) =>
          ref.groupId ? t.groupId === ref.groupId : t.journalId === ref.journalId,
        ),
    };
    const ops = (outbox ?? []).map((op) => ({
      id: op.id,
      op,
      info: describeQueuedChange(op, lookups),
    }));

    const toConfirm = rows
      .filter((row) => TO_CONFIRM_KINDS.has(row.kind) && TO_CONFIRM_STATES.has(row.state))
      .map((item): ConfirmEntry => {
        // A receipt still being read has no draft yet; its card shows "Reading receipt…".
        if (item.kind === 'receipt' && item.state === 'captured')
          return { id: item.id, item, draft: null, readiness: null, confirmable: false };
        const draft = readDraft(item.draftJson);
        const readiness = draftReadiness(draft);
        return { id: item.id, item, draft, readiness, confirmable: readiness.ready };
      });
    const toReview = rows.filter(
      (row) => row.kind === 'recurring_review' && row.state === 'confirmed',
    );
    const needsAttention: AttentionItem[] = [
      ...rows
        .filter((row) => row.state === 'error')
        .map((item): AttentionItem => ({ kind: 'inbox_error', id: item.id, item })),
      ...ops
        .filter(({ op }) => op.status === 'failed')
        .map((o): AttentionItem => ({ kind: 'outbox_failed', ...o })),
    ];
    const queued = ops.filter(({ op }) => op.status !== 'failed');

    return {
      needsAttention,
      toConfirm,
      toReview,
      queued,
      actionableCount: needsAttention.length + toConfirm.length + toReview.length,
    };
  }, [items, outbox, accounts, txs]);
}
