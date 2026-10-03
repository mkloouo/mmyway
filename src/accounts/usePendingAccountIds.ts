// Which accounts have an edit queued for FF3 that hasn't landed yet (the account page, the
// active/envelope switches, Reorder) — every account card shows a yellow dot for these.
import { useMemo } from 'react';
import { and, inArray } from 'drizzle-orm';
import { useDb } from '../providers/DbProvider';
import { useLiveQuery } from '../db/useLiveQuery';
import { outboxOperations } from '../db/schema';
import { readPayload } from '../sync/payloadJson';
import type { ReorderAccountsPayload, UpdateAccountPayload } from '../sync/outbox';

/** Pure half, for tests: account ids named by queued account operations. */
export function pendingAccountIds(ops: { kind: string; payloadJson: string }[]): Set<string> {
  const ids = new Set<string>();
  for (const op of ops) {
    try {
      // A queued reorder carries every account, so every card shows the dot until it lands —
      // which is honest: FF3 is given all of their positions, not just the ones that moved.
      if (op.kind === 'reorder_accounts')
        for (const id of readPayload<ReorderAccountsPayload>('reorder_accounts', op.payloadJson)
          .orderedIds)
          ids.add(id);
      else if (op.kind === 'update_account')
        ids.add(readPayload<UpdateAccountPayload>('update_account', op.payloadJson).accountId);
    } catch {
      // an unreadable payload fails its own operation; it just can't mark a card
    }
  }
  return ids;
}

export function usePendingAccountIds(): Set<string> {
  const db = useDb();
  const { data } = useLiveQuery(
    db
      .select({ kind: outboxOperations.kind, payloadJson: outboxOperations.payloadJson })
      .from(outboxOperations)
      .where(
        and(
          inArray(outboxOperations.kind, ['update_account', 'reorder_accounts']),
          inArray(outboxOperations.status, ['pending', 'in_flight', 'failed']),
        ),
      ),
  );
  return useMemo(() => pendingAccountIds(data ?? []), [data]);
}
