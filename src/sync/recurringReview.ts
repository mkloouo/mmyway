import { eq } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import type { TransactionRead } from '../api/ff3/types';
import { inboxItems } from '../db/schema';
import { enqueueOperation } from './outbox';
import type { OutboxDb } from './outbox';
import { generateId } from '../utils/id';

const REVIEWED_TAG = 'mmyway-reviewed';

export async function pullUnreviewedRecurring(db: OutboxDb, client: FF3Client): Promise<number> {
  const response = await client.request<{ data: TransactionRead[] }>('/v1/transactions?type=recurring&limit=100');
  let created = 0;
  const now = new Date().toISOString();

  for (const group of response.data) {
    const journal = group.attributes.transactions[0];
    if (!journal || journal.tags?.includes(REVIEWED_TAG)) continue;

    const existing = await db.select().from(inboxItems).where(eq(inboxItems.ff3GroupId, group.id));
    if (existing.length > 0) continue;

    await db.insert(inboxItems).values({
      id: generateId(),
      kind: 'recurring_review',
      state: 'confirmed', // arrives pre-parsed from the server; only needs a user decision (brief §4.3)
      draftJson: JSON.stringify(journal),
      ff3GroupId: group.id,
      createdAt: now,
      updatedAt: now,
    });
    created += 1;
  }
  return created;
}

export async function approveRecurringReview(db: OutboxDb, inboxItemId: string): Promise<void> {
  const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  const item = rows[0];
  if (!item?.ff3GroupId) throw new Error(`recurring review item ${inboxItemId} has no ff3GroupId`);
  const journal = JSON.parse(item.draftJson);

  await enqueueOperation(db, {
    id: generateId(),
    inboxItemId,
    kind: 'recurring_review',
    payload: { groupId: item.ff3GroupId, transactionJournalId: journal.transaction_journal_id, expectedUpdatedAt: journal.updated_at, changes: { tags: [...(journal.tags ?? []), REVIEWED_TAG] } },
  });
  await db.update(inboxItems).set({ state: 'synced', updatedAt: new Date().toISOString() }).where(eq(inboxItems.id, inboxItemId));
}
