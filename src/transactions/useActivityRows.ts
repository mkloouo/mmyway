import { useCallback, useMemo } from 'react';
import { and, desc, eq, inArray, isNotNull, max, ne } from 'drizzle-orm';
import { cachedTransactions, inboxItems, outboxOperations } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';
import { payloadGroupId, readPayload } from '../sync/payloadJson';
import type { CreateTransactionPayload } from '../sync/outbox';
import { pendingEdits, type PendingEdits } from './pendingEdits';
import { sumAmounts, type ActivityItem, type QueuedRow } from './activityRows';

export interface CacheFacts {
  groupIds: Set<string>;
  caughtUpAt: string | null;
}

export interface SentItemRow {
  id: string;
  kind: string;
  draftJson: string;
  ff3GroupId: string | null;
  updatedAt: string;
}

export interface ActivityRowsState {
  queuedRows: QueuedRow[];
  pendingDeletes: Set<string>;
  edits: PendingEdits;
  sentItems: SentItemRow[] | null;
  cacheFacts: CacheFacts | null;
  rowKey: (row: ActivityItem) => string;
}

export function useActivityRows(): ActivityRowsState {
  const db = useDb();

  const { data: outbox } = useLiveQuery(
    db.select().from(outboxOperations).where(ne(outboxOperations.kind, 'update_account')),
  );

  const { queuedRows, pendingDeletes, edits } = useMemo(() => {
    const ops = outbox ?? [];
    const queued: QueuedRow[] = ops
      .filter(
        (op) =>
          op.kind === 'create_transaction' &&
          (op.status === 'pending' || op.status === 'in_flight'),
      )
      .map((op): QueuedRow | null => {
        let payload: CreateTransactionPayload;
        try {
          payload = readPayload<CreateTransactionPayload>(op.kind, op.payloadJson);
        } catch {
          return null;
        }
        const split = payload.splits[0];
        if (!split) return null;
        const many = payload.splits.length > 1;
        return {
          queued: true,
          groupId: op.id,
          inboxItemId: op.inboxItemId,
          description: many ? (payload.groupTitle ?? split.description) : split.description,
          amount: many ? sumAmounts(payload.splits) : split.amount,
          currencyCode: split.currency_code ?? '',
          type: split.type,
          sourceId: split.source_id != null ? String(split.source_id) : null,
          destinationId: split.destination_id != null ? String(split.destination_id) : null,
          sourceName: split.source_name ?? null,
          destinationName: split.destination_name ?? null,
          categoryName: many ? null : (split.category_name ?? null),
          splits: many
            ? payload.splits.map((s) => ({
                label: s.category_name || s.description,
                amount: s.amount,
                categoryName: s.category_name ?? null,
              }))
            : [],
        };
      })
      .filter((r): r is QueuedRow => !!r);

    const deletes = new Set(
      ops
        .filter((op) => op.kind === 'delete_transaction' && op.status !== 'failed')
        .map((op) => payloadGroupId(op.kind, op.payloadJson))
        .filter((id): id is string => !!id),
    );
    return { queuedRows: queued, pendingDeletes: deletes, edits: pendingEdits(ops) };
  }, [outbox]);

  const { data: sentItems } = useLiveQuery(
    db
      .select({
        id: inboxItems.id,
        kind: inboxItems.kind,
        draftJson: inboxItems.draftJson,
        ff3GroupId: inboxItems.ff3GroupId,
        updatedAt: inboxItems.updatedAt,
      })
      .from(inboxItems)
      .where(and(eq(inboxItems.state, 'synced'), isNotNull(inboxItems.ff3GroupId)))
      .orderBy(desc(inboxItems.updatedAt))
      .limit(30),
  );

  const inboxByGroup = useMemo(
    () => new Map((sentItems ?? []).map((i) => [i.ff3GroupId!, i.id])),
    [sentItems],
  );

  const sentGroupIds = (sentItems ?? []).map((i) => i.ff3GroupId!);
  const { data: sentCached } = useLiveQuery(
    db
      .select({ id: cachedTransactions.groupId })
      .from(cachedTransactions)
      .where(inArray(cachedTransactions.groupId, sentGroupIds)),
    [sentGroupIds.join(',')],
  );
  const { data: caughtUpRows } = useLiveQuery(
    db.select({ at: max(cachedTransactions.syncedAt) }).from(cachedTransactions),
  );

  const cacheFacts = useMemo(
    () =>
      sentCached && caughtUpRows
        ? {
            groupIds: new Set(sentCached.map((r) => r.id)),
            caughtUpAt: caughtUpRows[0]?.at ?? null,
          }
        : null,
    [sentCached, caughtUpRows],
  );

  const rowKey = useCallback(
    (row: ActivityItem) => {
      if ('queued' in row) return row.inboxItemId ? `inbox:${row.inboxItemId}` : row.groupId;
      const inboxId = inboxByGroup.get(row.groupId);
      return inboxId ? `inbox:${inboxId}` : row.groupId;
    },
    [inboxByGroup],
  );

  return {
    queuedRows,
    pendingDeletes,
    edits,
    sentItems: sentItems ?? null,
    cacheFacts,
    rowKey,
  };
}
