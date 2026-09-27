import { createTestDb } from '../db/client';
import { upsertAlias } from '../lookup/aliases';
import { createManualEntry, confirmInboxItem } from './createManualEntry';
import { outboxOperations, inboxItems } from '../db/schema';
import { eq } from 'drizzle-orm';

describe('createManualEntry + confirmInboxItem', () => {
  it('flags a merchant with no alias as a new payee and only enqueues after confirm', async () => {
    const db = createTestDb();
    const { inboxItemId, isNewPayee } = await createManualEntry(db as any, {
      type: 'withdrawal', amount: '30.00', currencyCode: 'PLN', date: new Date().toISOString(),
      description: 'McDonalds', merchantRawInput: 'McDonalds',
    });
    expect(isNewPayee).toBe(true);

    let ops = await db.select().from(outboxOperations);
    expect(ops).toHaveLength(0); // nothing enqueued before confirm — Global Constraints

    await confirmInboxItem(db as any, inboxItemId);
    ops = await db.select().from(outboxOperations);
    expect(ops).toHaveLength(1);

    const item = (await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId)))[0];
    expect(item?.state).toBe('confirmed');
  });

  it('resolves an existing alias to destination_id, not a fresh payee', async () => {
    const db = createTestDb();
    await upsertAlias(db as any, { kind: 'payee', rawInput: 'Żabka', targetId: 'acc-99', targetName: 'Żabka' });
    const { isNewPayee } = await createManualEntry(db as any, {
      type: 'withdrawal', amount: '15.90', currencyCode: 'PLN', date: new Date().toISOString(),
      description: 'snacks', merchantRawInput: 'zabka',
    });
    expect(isNewPayee).toBe(false);
  });
});
