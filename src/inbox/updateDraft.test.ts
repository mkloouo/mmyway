import { createTestDb } from '../db/testDb';
import { createManualEntry, confirmInboxItem } from './createManualEntry';
import { updateDraft, deleteInboxItem } from './updateDraft';
import { inboxItems, outboxOperations } from '../db/schema';
import { eq } from 'drizzle-orm';
import { writeDraft } from './draftJson';

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

describe('updateDraft and what the receipt reader was unsure of', () => {
  it('stops marking a field once the user sets it', async () => {
    const db = createTestDb();
    await db.insert(inboxItems).values({
      id: 'r1',
      kind: 'receipt',
      state: 'parsed',
      draftJson: writeDraft({
        type: 'withdrawal',
        amount: '42.50',
        currencyCode: 'PLN',
        date: '2026-09-15T10:00:00.000Z',
        description: 'Żabka',
        destinationName: 'Żabka',
        isNewPayee: true,
        lowConfidenceFields: ['amount', 'date'],
      }),
      createdAt: 'c',
      updatedAt: 'u',
    });

    await updateDraft(db as any, 'r1', { amount: '41.50' });
    let row = (await db.select().from(inboxItems).where(eq(inboxItems.id, 'r1')))[0]!;
    expect(JSON.parse(row.draftJson).lowConfidenceFields).toEqual(['date']);

    await updateDraft(db as any, 'r1', { date: '2026-09-14T10:00:00.000Z' });
    row = (await db.select().from(inboxItems).where(eq(inboxItems.id, 'r1')))[0]!;
    expect(JSON.parse(row.draftJson).lowConfidenceFields).toBeUndefined();
  });
});
