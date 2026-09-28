import { eq } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import type { TransactionRead, TransactionSplit } from '../api/ff3/types';
import { inboxItems, plannedObjects } from '../db/schema';
import { enqueueOperation } from './outbox';
import type { NewOutboxOperation, OutboxDb } from './outbox';
import { generateId } from '../utils/id';
import { readReviewJournal, writeDraft, type ReviewJournal } from '../inbox/draftJson';
import { plannedKey, readPlannedRow } from '../planned/objects';
import { atPlannedTime, readPlannedTime } from '../planned/plannedTime';
import { normkey } from '../lookup/normkey';

const REVIEWED_TAG = 'mmyway-reviewed';

/** How far before the last sync (or now, on a first sync) a recurring pull reaches back. */
const RECURRING_LOOKBACK_DAYS = 14;

export async function pullUnreviewedRecurring(db: OutboxDb, client: FF3Client, opts: { since?: string | null } = {}): Promise<number> {
  // Defect (2): `recurring` is a tag applied to transactions spawned from FF3's recurrence
  // engine, not a `type` value (`type` only takes withdrawal/deposit/transfer/...) — the old
  // `?type=recurring` filter could never match anything. Fetch by tag instead.
  // Bounded by date: every recurring transaction ever posted carries the tag, and none from
  // before this app has the reviewed tag — an unbounded first pull turned up to 100 of them into
  // review cards. Reaching back from the last sync, not from today, still catches everything
  // that fired while the app wasn't opened.
  const from = new Date(opts.since ?? Date.now());
  from.setDate(from.getDate() - RECURRING_LOOKBACK_DAYS);
  const response = await client.request<{ data: TransactionRead[] }>(`/v1/tags/recurring/transactions?start=${from.toISOString().slice(0, 10)}&limit=100`);
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
      draftJson: writeDraft({ ...journal, updated_at: groupUpdatedAt }),
      ff3GroupId: group.id,
      createdAt: now,
      updatedAt: now,
    });
    created += 1;
  }
  return created;
}

/**
 * The one path approve, edit and delete share: read the review item, queue what the user decided
 * (conflict-checked against the updated_at stored with it), and take the card out of the Inbox.
 */
async function decideRecurringReview(
  db: OutboxDb,
  inboxItemId: string,
  decide: (groupId: string, journal: ReviewJournal) => NewOutboxOperation['payload'] & object,
  kind: 'recurring_review' | 'delete_transaction',
): Promise<void> {
  const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  if (!item?.ff3GroupId) throw new Error(`recurring review item ${inboxItemId} has no ff3GroupId`);
  const journal = readReviewJournal(item.draftJson);
  await enqueueOperation(db, { id: generateId(), inboxItemId, kind, payload: decide(item.ff3GroupId, journal) });
  await db.update(inboxItems).set({ state: 'synced', updatedAt: new Date().toISOString() }).where(eq(inboxItems.id, inboxItemId));
}

export async function approveRecurringReview(db: OutboxDb, inboxItemId: string): Promise<void> {
  await editRecurringReview(db, inboxItemId, {});
}

// R2/R3: approve with corrections (amount, currency, account) in the same PUT that adds the
// reviewed tag — one partial update keyed by transaction_journal_id; a plain approve is this
// with no corrections.
export async function editRecurringReview(db: OutboxDb, inboxItemId: string, changes: Partial<TransactionSplit>): Promise<void> {
  const [item] = await db.select({ draftJson: inboxItems.draftJson }).from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  const plannedDate = item && !changes.date ? await plannedDateFor(db, readReviewJournal(item.draftJson)) : null;
  await decideRecurringReview(db, inboxItemId, (groupId, journal) => ({
    groupId,
    transactionJournalId: journal.transaction_journal_id,
    expectedUpdatedAt: journal.updated_at,
    changes: { ...changes, ...(plannedDate ? { date: plannedDate } : {}), tags: [...(journal.tags ?? []), REVIEWED_TAG] },
  }), 'recurring_review');
}

/**
 * FF3 books a recurring transaction at whatever time its daily job ran. When the Planned tab gave
 * its recurrence a time (the `mmyway-time` line in its notes), approving moves it to that time
 * on the day it was booked. Found by the journal's recurrence id, else by the recurrence's title.
 */
async function plannedDateFor(db: OutboxDb, journal: ReviewJournal): Promise<string | null> {
  if (!journal.date) return null;
  const recurrenceId = (journal as { recurrence_id?: string | number | null }).recurrence_id;
  let notes: string | null | undefined;
  if (recurrenceId != null) {
    const [row] = await db.select().from(plannedObjects).where(eq(plannedObjects.key, plannedKey('recurrence', String(recurrenceId))));
    notes = row ? (readPlannedRow(row)?.attributes as { notes?: string | null } | undefined)?.notes : undefined;
  }
  if (notes === undefined && journal.description) {
    const rows = await db.select().from(plannedObjects).where(eq(plannedObjects.kind, 'recurrence'));
    const match = rows.find((r) => normkey(r.name) === normkey(journal.description!));
    notes = match ? (readPlannedRow(match)?.attributes as { notes?: string | null } | undefined)?.notes : undefined;
  }
  const time = readPlannedTime(notes);
  return time ? atPlannedTime(journal.date, time) : null;
}

export async function deleteRecurringReview(db: OutboxDb, inboxItemId: string): Promise<void> {
  await decideRecurringReview(db, inboxItemId, (groupId, journal) => ({ groupId, expectedUpdatedAt: journal.updated_at }), 'delete_transaction');
}
