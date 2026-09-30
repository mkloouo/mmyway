import { eq } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import type { TransactionRead, TransactionSplit } from '../api/ff3/types';
import { inboxItems, plannedObjects } from '../db/schema';
import { enqueueOperation } from './outbox';
import type { NewOutboxOperation, OutboxDb } from './outbox';
import { generateId } from '../utils/id';
import { readReviewJournal, writeDraft, type ReviewJournal } from '../inbox/draftJson';
import { plannedKey, readPlannedRow, type PlannedObject } from '../planned/objects';
import { atPlannedTime, readPlannedTime } from '../planned/plannedTime';
import { normkey } from '../lookup/normkey';
import { fetchAll } from './referenceData';

const REVIEWED_TAG = 'mmyway-reviewed';

/** How far before the last sync (or now, on a first sync) a recurring pull reaches back. */
const RECURRING_LOOKBACK_DAYS = 14;

export async function pullUnreviewedRecurring(
  db: OutboxDb,
  client: FF3Client,
  opts: { since?: string | null } = {},
): Promise<number> {
  // FF3 marks a transaction its recurrence engine booked with the journal's recurrence_id — it
  // adds no tag, so the old `/v1/tags/recurring` fetch never saw one. There's no filter for it,
  // so every transaction in the window is fetched and the rest skipped.
  // Bounded by date: none from before this app has the reviewed tag, and an unbounded first pull
  // turned up to 100 of them into review cards. Reaching back from the last sync, not from today,
  // still catches everything that fired while the app wasn't opened. The end reaches ahead
  // because triggering a recurrence early books it on its future date; FF3 ignores a start given
  // without an end.
  const from = new Date(opts.since ?? Date.now());
  from.setDate(from.getDate() - RECURRING_LOOKBACK_DAYS);
  const to = new Date();
  to.setFullYear(to.getFullYear() + 1);
  const groups = await fetchAll<TransactionRead>(
    client,
    `/v1/transactions?start=${from.toISOString().slice(0, 10)}&end=${to.toISOString().slice(0, 10)}`,
  );
  let created = 0;
  const now = new Date().toISOString();

  for (const group of groups) {
    const journal = group.attributes.transactions[0];
    if (
      !journal ||
      (journal as { recurrence_id?: string | number | null }).recurrence_id == null ||
      journal.tags?.includes(REVIEWED_TAG)
    )
      continue;

    const [existing] = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.ff3GroupId, group.id));
    if (existing) {
      // A card pulled before the planned currency was recorded picks it up on the next sync.
      if (existing.state !== 'confirmed') continue;
      const stored = readReviewJournal(existing.draftJson);
      const updated = await withPlannedForeign(db, stored);
      if (updated !== stored)
        await db
          .update(inboxItems)
          .set({ draftJson: writeDraft(updated), updatedAt: now })
          .where(eq(inboxItems.id, existing.id));
      continue;
    }

    // FF3 puts updated_at on the group's attributes, not on each split — journal.updated_at is
    // undefined against real API responses despite what TransactionSplit's type claims. Fix it
    // once here so every downstream reader (approve/edit/delete, all of which JSON.parse this
    // draftJson) sees a correct value without having to know about the mismatch.
    const groupUpdatedAt =
      (group.attributes as { updated_at?: string }).updated_at ?? journal.updated_at;
    const reviewJournal = await withPlannedForeign(
      db,
      readReviewJournal(writeDraft({ ...journal, updated_at: groupUpdatedAt })),
    );

    await db.insert(inboxItems).values({
      id: generateId(),
      kind: 'recurring_review',
      state: 'confirmed', // arrives pre-parsed from the server; only needs a user decision (brief §4.3)
      draftJson: writeDraft(reviewJournal),
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
  await enqueueOperation(db, {
    id: generateId(),
    inboxItemId,
    kind,
    payload: decide(item.ff3GroupId, journal),
  });
  await db
    .update(inboxItems)
    .set({ state: 'synced', updatedAt: new Date().toISOString() })
    .where(eq(inboxItems.id, inboxItemId));
}

export async function approveRecurringReview(db: OutboxDb, inboxItemId: string): Promise<void> {
  await editRecurringReview(db, inboxItemId, {});
}

// R2/R3: approve with corrections (amount, currency, account) in the same PUT that adds the
// reviewed tag — one partial update keyed by transaction_journal_id; a plain approve is this
// with no corrections.
export async function editRecurringReview(
  db: OutboxDb,
  inboxItemId: string,
  changes: Partial<TransactionSplit>,
): Promise<void> {
  const [item] = await db
    .select({ draftJson: inboxItems.draftJson })
    .from(inboxItems)
    .where(eq(inboxItems.id, inboxItemId));
  const plannedDate =
    item && !changes.date ? await plannedDateFor(db, readReviewJournal(item.draftJson)) : null;
  await decideRecurringReview(
    db,
    inboxItemId,
    (groupId, journal) => ({
      groupId,
      transactionJournalId: journal.transaction_journal_id,
      expectedUpdatedAt: journal.updated_at,
      changes: {
        ...changes,
        ...(plannedDate ? { date: plannedDate } : {}),
        tags: [...(journal.tags ?? []), REVIEWED_TAG],
      },
    }),
    'recurring_review',
  );
}

/**
 * FF3 books a recurring transaction at whatever time its daily job ran. When the Planned tab gave
 * it a time (the `[mmyway time=…]` marker in its rule's description, src/planned/plannedTime.ts),
 * approving moves it to that time on the day it was booked. The rule is the one the Planned tab
 * pairs with the recurrence: the same name. A recurrence's own notes held the time before.
 */
async function plannedDateFor(db: OutboxDb, journal: ReviewJournal): Promise<string | null> {
  if (!journal.date) return null;
  const recurrence = await recurrenceRowFor(db, journal);
  if (!recurrence) return null;
  const rules = await db.select().from(plannedObjects).where(eq(plannedObjects.kind, 'rule'));
  const ruleRow = rules.find((r) => normkey(r.name) === normkey(recurrence.name));
  const rule = ruleRow ? readPlannedRow(ruleRow) : null;
  const time =
    readPlannedTime(rule?.attributes.description as string | null | undefined) ??
    readPlannedTime((recurrence.attributes as RecurrenceAttributes).notes);
  return time ? atPlannedTime(journal.date, time) : null;
}

type RecurrenceAttributes = {
  notes?: string | null;
  transactions?: { amount?: string | null; currency_code?: string | null }[];
};

/** The cached recurrence that booked a journal: by the journal's recurrence id, else by title. */
async function recurrenceRowFor(
  db: OutboxDb,
  journal: ReviewJournal,
): Promise<PlannedObject | null> {
  const recurrenceId = (journal as { recurrence_id?: string | number | null }).recurrence_id;
  if (recurrenceId != null) {
    const [row] = await db
      .select()
      .from(plannedObjects)
      .where(eq(plannedObjects.key, plannedKey('recurrence', String(recurrenceId))));
    if (row) return readPlannedRow(row);
  }
  if (!journal.description) return null;
  const rows = await db.select().from(plannedObjects).where(eq(plannedObjects.kind, 'recurrence'));
  const match = rows.find((r) => normkey(r.name) === normkey(journal.description!));
  return match ? readPlannedRow(match) : null;
}

async function recurrenceFor(
  db: OutboxDb,
  journal: ReviewJournal,
): Promise<RecurrenceAttributes | undefined> {
  return (await recurrenceRowFor(db, journal))?.attributes as RecurrenceAttributes | undefined;
}

/**
 * A recurrence planned in another currency than its account's (the Planned tab saves Spotify's
 * 7.99 USD from a PLN account) is booked by FF3 as 7.99 in the account's currency. Records the
 * planned amount as the journal's foreign amount, so the review asks what was actually charged.
 */
async function withPlannedForeign(db: OutboxDb, journal: ReviewJournal): Promise<ReviewJournal> {
  if (journal.foreign_amount && journal.foreign_currency_code) return journal;
  const planned = (await recurrenceFor(db, journal))?.transactions?.[0];
  if (!planned?.amount || !planned.currency_code || planned.currency_code === journal.currency_code)
    return journal;
  return {
    ...journal,
    foreign_amount: planned.amount,
    foreign_currency_code: planned.currency_code,
  };
}

export async function deleteRecurringReview(db: OutboxDb, inboxItemId: string): Promise<void> {
  await decideRecurringReview(
    db,
    inboxItemId,
    (groupId, journal) => ({ groupId, expectedUpdatedAt: journal.updated_at }),
    'delete_transaction',
  );
}
