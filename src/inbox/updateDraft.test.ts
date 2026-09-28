import { createTestDb } from '../db/testDb';
import { createManualEntry, confirmInboxItem } from './createManualEntry';
import { updateDraft, deleteInboxItem } from './updateDraft';
import { inboxItems, outboxOperations } from '../db/schema';
import { eq } from 'drizzle-orm';

describe('updateDraft', () => {
  it('preserves isNewPayee across a save that changes other fields', async () => {
    const db = createTestDb();
    const { inboxItemId } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '10.00',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'coffee',
      merchantRawInput: 'Costa',
    });

    await updateDraft(db as any, inboxItemId, { notes: 'extra shot' });

    const row = (await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId)))[0]!;
    const draft = JSON.parse(row.draftJson);
    expect(draft.notes).toBe('extra shot');
    expect(draft.isNewPayee).toBe(true);
  });

  it('throws on an already-synced item', async () => {
    const db = createTestDb();
    const { inboxItemId } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '10.00',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'coffee',
      merchantRawInput: 'Costa',
    });
    await confirmInboxItem(db as any, inboxItemId);
    await db.update(inboxItems).set({ state: 'synced' }).where(eq(inboxItems.id, inboxItemId));

    await expect(updateDraft(db as any, inboxItemId, { notes: 'too late' })).rejects.toThrow();
  });

  it('throws on an already-confirmed item, before sync even runs', async () => {
    const db = createTestDb();
    const { inboxItemId } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '10.00',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'coffee',
      merchantRawInput: 'Costa',
    });
    await confirmInboxItem(db as any, inboxItemId);

    await expect(updateDraft(db as any, inboxItemId, { notes: 'too late' })).rejects.toThrow();
  });
});

describe('deleteInboxItem', () => {
  it('removes the inbox row and any outbox op still pointing at it', async () => {
    const db = createTestDb();
    const { inboxItemId } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '10.00',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'coffee',
      merchantRawInput: 'Costa',
    });
    await confirmInboxItem(db as any, inboxItemId);
    expect(await db.select().from(outboxOperations)).toHaveLength(1);

    await deleteInboxItem(db as any, inboxItemId);

    expect(await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId))).toHaveLength(
      0,
    );
    expect(await db.select().from(outboxOperations)).toHaveLength(0);
  });
});
