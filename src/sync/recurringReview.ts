import { eq } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import type { TransactionRead, TransactionSplit } from '../api/ff3/types';
import { inboxItems } from '../db/schema';
import { enqueueOperation } from './outbox';
import type { OutboxDb } from './outbox';
import { generateId } from '../utils/id';

const REVIEWED_TAG = 'mmyway-reviewed';

export async function pullUnreviewedRecurring(db: OutboxDb, client: FF3Client): Promise<number> {
  // Defect (2): `recurring` is a tag applied to transactions spawned from FF3's recurrence
  // engine, not a `type` value (`type` only takes withdrawal/deposit/transfer/...) — the old
  // `?type=recurring` filter could never match anything. Fetch by tag instead.
  const response = await client.request<{ data: TransactionRead[] }>('/v1/tags/recurring/transactions?limit=100');
  let created = 0;
  const now = new Date().toISOString();

  for (const group of response.data) {
    const journal = group.attributes.transactions[0];
    if (!journal || journal.tags?.includes(REVIEWED_TAG)) continue;

    const existing = await db.select().from(inboxItems).where(eq(inboxItems.ff3GroupId, group.id));
    if (existing.length > 0) continue;

    // FF3 puts updated_at on the group's attributes, not on each split — journal.updated_at is
    // undefined against real API responses despite what TransactionSplit's type claims. Fix it
    // once here so every downstream reader (approve/edit/delete, all of which JSON.parse this
    // draftJson) sees a correct value without having to know about the mismatch.
    const groupUpdatedAt = (group.attributes as { updated_at?: string }).updated_at ?? journal.updated_at;

    await db.insert(inboxItems).values({
      id: generateId(),
      kind: 'recurring_review',
      state: 'confirmed', // arrives pre-parsed from the server; only needs a user decision (brief §4.3)
      draftJson: JSON.stringify({ ...journal, updated_at: groupUpdatedAt }),
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

// R2/R3: approve with corrections (amount, currency, account) in the same PUT that adds the
// reviewed tag — one partial update keyed by transaction_journal_id, conflict-checked against
// the cached updated_at the same way approveRecurringReview is (both route through outbox's
// 'recurring_review' kind).
export async function editRecurringReview(db: OutboxDb, inboxItemId: string, changes: Partial<TransactionSplit>): Promise<void> {
  const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  const item = rows[0];
  if (!item?.ff3GroupId) throw new Error(`recurring review item ${inboxItemId} has no ff3GroupId`);
  const journal = JSON.parse(item.draftJson);

  await enqueueOperation(db, {
    id: generateId(),
    inboxItemId,
    kind: 'recurring_review',
    payload: {
      groupId: item.ff3GroupId,
      transactionJournalId: journal.transaction_journal_id,
      expectedUpdatedAt: journal.updated_at,
      changes: { ...changes, tags: [...(journal.tags ?? []), REVIEWED_TAG] },
    },
  });
  await db.update(inboxItems).set({ state: 'synced', updatedAt: new Date().toISOString() }).where(eq(inboxItems.id, inboxItemId));
}

export async function deleteRecurringReview(db: OutboxDb, inboxItemId: string): Promise<void> {
  const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  const item = rows[0];
  if (!item?.ff3GroupId) throw new Error(`recurring review item ${inboxItemId} has no ff3GroupId`);
  const journal = JSON.parse(item.draftJson);

  await enqueueOperation(db, {
    id: generateId(),
    inboxItemId,
    kind: 'delete_transaction',
    payload: { groupId: item.ff3GroupId, expectedUpdatedAt: journal.updated_at },
  });
  await db.update(inboxItems).set({ state: 'synced', updatedAt: new Date().toISOString() }).where(eq(inboxItems.id, inboxItemId));
}
