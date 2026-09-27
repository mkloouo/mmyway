import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { outboxOperations, inboxItems } from '../db/schema';
import { createManualEntry, confirmInboxItem } from '../inbox/createManualEntry';
import { discardOperation, enqueueOperation } from './outbox';

describe('discardOperation', () => {
  it('drops the operation and returns a confirmed entry to the Inbox as a draft', async () => {
    const db = createTestDb();
    const { inboxItemId } = await createManualEntry(db as any, { type: 'withdrawal', amount: '1', currencyCode: 'PLN', date: '2026-09-27T10:00:00Z', description: 'x', merchantRawInput: 'x', forceNewPayee: true, sourceId: '1' });
    const { outboxOperationId } = await confirmInboxItem(db as any, inboxItemId);

    await discardOperation(db as any, outboxOperationId);

    expect(await db.select().from(outboxOperations)).toHaveLength(0);
    const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
    expect(item?.state).toBe('captured');
  });
  it('leaves other operations alone', async () => {
    const db = createTestDb();
    await enqueueOperation(db, { id: 'a', kind: 'update_account', payload: { accountId: '1', active: false } });
    await enqueueOperation(db, { id: 'b', kind: 'update_account', payload: { accountId: '2', active: false } });
    await discardOperation(db as any, 'a');
    expect((await db.select().from(outboxOperations)).map((r) => r.id)).toEqual(['b']);
  });
});
