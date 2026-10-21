import { eq } from 'drizzle-orm';
import { useDb } from '../providers/DbProvider';
import { useLiveQuery } from '../db/useLiveQuery';
import { inboxItems, outboxOperations } from '../db/schema';
import type { InboxItemRow } from './useInboxSections';

export function useDraftItem(id: string): InboxItemRow | undefined {
  const db = useDb();
  const { data: rows } = useLiveQuery(db.select().from(inboxItems).where(eq(inboxItems.id, id)), [
    id,
  ]);
  return rows?.[0];
}

export function usePendingCreate(id: string) {
  const db = useDb();
  const { data: ops } = useLiveQuery(
    db.select().from(outboxOperations).where(eq(outboxOperations.inboxItemId, id)),
    [id],
  );
  return (
    (ops ?? []).find((op) => op.kind === 'create_transaction' && op.status !== 'in_flight') ?? null
  );
}
