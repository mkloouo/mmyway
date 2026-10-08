// What the bottom tab badge shows (TabsLayout): the number of unfinished items waiting in the
// Inbox. Unlike useInboxSections, this reads only the two status columns needed for the count,
// skipping the joins with cached_transactions and reference_accounts and the JSON decoding of
// every draft while the user is on other tabs.
import { useMemo } from 'react';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';
import { inboxItems, outboxOperations } from '../db/schema';

const TO_CONFIRM_KINDS = new Set(['manual_entry', 'receipt']);
const TO_CONFIRM_STATES = new Set(['captured', 'parsed']);

export function useActionableCount({ enabled = true }: { enabled?: boolean } = {}): number {
  const db = useDb();
  const { data: items } = useLiveQuery(
    db.select({ kind: inboxItems.kind, state: inboxItems.state }).from(inboxItems),
    [],
    enabled,
  );
  const { data: failedOps } = useLiveQuery(
    db
      .select({ id: outboxOperations.id })
      .from(outboxOperations)
      .where(eq(outboxOperations.status, 'failed')),
    [],
    enabled,
  );

  return useMemo(() => {
    let count = (failedOps ?? []).length;
    for (const item of items ?? []) {
      if (item.state === 'error') {
        count++;
      } else if (TO_CONFIRM_KINDS.has(item.kind) && TO_CONFIRM_STATES.has(item.state)) {
        count++;
      } else if (item.kind === 'recurring_review' && item.state === 'parsed') {
        count++;
      }
    }
    return count;
  }, [items, failedOps]);
}
