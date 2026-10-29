import { sql } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { inboxItems, outboxOperations } from '../db/schema';
import { confirmInboxItem, createManualEntry, undoConfirm } from '../inbox/createManualEntry';
import { writeDraft } from '../inbox/draftJson';
import { discardOperation, recoverInFlight, retryOperationNow } from './outbox';
import { approveRecurringReview, deleteRecurringReview } from './recurringReview';

async function entry(db: ReturnType<typeof createTestDb>) {
  return createManualEntry(db, {
    type: 'withdrawal',
    amount: '10.00',
    currencyCode: 'PLN',
    date: '2026-10-28T12:00:00Z',
    description: 'Coffee',
    sourceId: '1',
    merchantRawInput: 'Cafe',
  });
}

async function review(db: ReturnType<typeof createTestDb>) {
  await db.insert(inboxItems).values({
    id: 'review',
    kind: 'recurring_review',
    state: 'parsed',
    ff3GroupId: 'g1',
    draftJson: writeDraft({ transaction_journal_id: 'j1', updated_at: 'v1', tags: [] }),
    createdAt: 'now',
    updatedAt: 'now',
  });
}

it('allows only one of two overlapping confirmations to queue a create', async () => {
  const db = createTestDb();
  const { inboxItemId } = await entry(db);
  const results = await Promise.allSettled([
    confirmInboxItem(db, inboxItemId),
    confirmInboxItem(db, inboxItemId),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await db.select().from(outboxOperations)).toHaveLength(1);
});

it('rolls back the queued create if restoring the draft during Undo fails', async () => {
  const db = createTestDb();
  const { inboxItemId } = await entry(db);
  const undo = await confirmInboxItem(db, inboxItemId);
  db.run(sql`CREATE TRIGGER fail_restore BEFORE UPDATE ON inbox_items
    BEGIN SELECT RAISE(ABORT, 'write failed'); END`);
  await expect(undoConfirm(db, inboxItemId, undo)).rejects.toThrow();
  expect(await db.select().from(outboxOperations)).toHaveLength(1);
  expect((await db.select().from(inboxItems))[0]?.state).toBe('confirmed');
});

it('never treats an interrupted first send as safe to undo or discard offline', async () => {
  const db = createTestDb();
  const { inboxItemId } = await entry(db);
  const undo = await confirmInboxItem(db, inboxItemId);
  await db.update(outboxOperations).set({ status: 'in_flight' });
  await recoverInFlight(db);
  expect(await undoConfirm(db, inboxItemId, undo)).toBe('already_sent');
  expect(await discardOperation(db, undo.outboxOperationId)).toBe('unreachable');
  expect(await db.select().from(outboxOperations)).toHaveLength(1);
});

it('does not release the replay claim when Retry is pressed on an in-flight operation', async () => {
  const db = createTestDb();
  const { inboxItemId } = await entry(db);
  const undo = await confirmInboxItem(db, inboxItemId);
  await db.update(outboxOperations).set({ status: 'in_flight' });
  await retryOperationNow(db, undo.outboxOperationId);
  expect((await db.select().from(outboxOperations))[0]?.status).toBe('in_flight');
});

it('does not enqueue a second recurring decision after that review has left the Inbox', async () => {
  const db = createTestDb();
  await review(db);
  await approveRecurringReview(db, 'review');
  await expect(deleteRecurringReview(db, 'review')).rejects.toThrow('invalid transition');
  expect(await db.select().from(outboxOperations)).toHaveLength(1);
});

it('rolls back a recurring decision when changing the Inbox state fails', async () => {
  const db = createTestDb();
  await review(db);
  db.run(sql`CREATE TRIGGER fail_review BEFORE UPDATE ON inbox_items
    BEGIN SELECT RAISE(ABORT, 'write failed'); END`);
  await expect(approveRecurringReview(db, 'review')).rejects.toThrow();
  expect(await db.select().from(outboxOperations)).toHaveLength(0);
  expect((await db.select().from(inboxItems))[0]?.state).toBe('parsed');
});
