import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { inboxItems, outboxOperations } from '../db/schema';
import { createManualEntry, confirmInboxItem } from './createManualEntry';
import { updateDraft, retryErroredItem } from './updateDraft';
import { readDraft } from './draftJson';
import { readPayload } from '../sync/payloadJson';
import type { CreateTransactionPayload } from '../sync/outbox';

async function entry() {
  const db = createTestDb();
  const { inboxItemId } = await createManualEntry(db, {
    type: 'withdrawal',
    amount: '10.00',
    currencyCode: 'PLN',
    date: '2026-10-28T12:00:00Z',
    description: 'Coffee',
    sourceId: 'wallet',
    merchantRawInput: 'Cafe',
  });
  return { db, inboxItemId };
}

it('preserves independent edits made before the next render', async () => {
  const { db, inboxItemId } = await entry();
  await Promise.all([
    updateDraft(db, inboxItemId, { amount: '12.50' }),
    updateDraft(db, inboxItemId, { notes: 'corrected receipt' }),
  ]);
  const [item] = await db.select().from(inboxItems);
  expect(readDraft(item!.draftJson)).toMatchObject({ amount: '12.50', notes: 'corrected receipt' });
});

it('confirms the latest edit even when both handlers run before the next render', async () => {
  const { db, inboxItemId } = await entry();
  await Promise.all([
    updateDraft(db, inboxItemId, { amount: '12.50' }),
    confirmInboxItem(db, inboxItemId),
  ]);
  const [op] = await db.select().from(outboxOperations);
  expect(readPayload<CreateTransactionPayload>(op!.kind, op!.payloadJson).splits[0]!.amount).toBe(
    '12.50',
  );
});

it('a stale Retry action cannot turn a confirmed draft back into an editable entry', async () => {
  const { db, inboxItemId } = await entry();
  await confirmInboxItem(db, inboxItemId);
  await retryErroredItem(db, inboxItemId);
  const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  expect(item!.state).toBe('confirmed');
  await expect(confirmInboxItem(db, inboxItemId)).rejects.toThrow();
  expect(await db.select().from(outboxOperations)).toHaveLength(1);
});
