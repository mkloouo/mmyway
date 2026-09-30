import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { outboxOperations, inboxItems } from '../db/schema';
import { createManualEntry, confirmInboxItem } from '../inbox/createManualEntry';
import { discardOperation, enqueueOperation } from './outbox';

describe('discardOperation', () => {
  it('drops the operation and returns a confirmed entry to the Inbox as a draft', async () => {
    const db = createTestDb();
    const { inboxItemId } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '1',
      currencyCode: 'PLN',
      date: '2026-09-27T10:00:00Z',
      description: 'x',
      merchantRawInput: 'x',
      forceNewPayee: true,
      sourceId: '1',
    });
    const { outboxOperationId } = await confirmInboxItem(db as any, inboxItemId);

    await discardOperation(db as any, outboxOperationId);

    expect(await db.select().from(outboxOperations)).toHaveLength(0);
    const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
    expect(item?.state).toBe('captured');
  });
  it('leaves other operations alone', async () => {
    const db = createTestDb();
    await enqueueOperation(db, {
      id: 'a',
      kind: 'update_account',
      payload: { accountId: '1', active: false },
    });
    await enqueueOperation(db, {
      id: 'b',
      kind: 'update_account',
      payload: { accountId: '2', active: false },
    });
    await discardOperation(db as any, 'a');
    expect((await db.select().from(outboxOperations)).map((r) => r.id)).toEqual(['b']);
  });

  it('refuses a change already on its way', async () => {
    const db = createTestDb();
    await enqueueOperation(db, {
      id: 'a',
      kind: 'update_account',
      payload: { accountId: '1', active: false },
    });
    await db
      .update(outboxOperations)
      .set({ status: 'in_flight' })
      .where(eq(outboxOperations.id, 'a'));
    expect(await discardOperation(db as any, 'a')).toBe('sending');
    expect(await db.select().from(outboxOperations)).toHaveLength(1);
  });

  it('returns a receipt to the Inbox as read, so the photo is not read again', async () => {
    const db = createTestDb();
    const { inboxItemId } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '1',
      currencyCode: 'PLN',
      date: '2026-09-27T10:00:00Z',
      description: 'x',
      merchantRawInput: 'x',
      sourceId: '1',
    });
    await db.update(inboxItems).set({ kind: 'receipt' }).where(eq(inboxItems.id, inboxItemId));
    const { outboxOperationId } = await confirmInboxItem(db as any, inboxItemId);

    expect(await discardOperation(db as any, outboxOperationId)).toBe('discarded');
    const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
    expect(item?.state).toBe('parsed');
  });

  describe('a create that was already attempted', () => {
    async function failedCreate() {
      const db = createTestDb();
      const { inboxItemId } = await createManualEntry(db as any, {
        type: 'withdrawal',
        amount: '30',
        currencyCode: 'PLN',
        date: '2026-09-27T10:00:00Z',
        description: 'x',
        merchantRawInput: 'x',
        sourceId: '1',
      });
      const { outboxOperationId } = await confirmInboxItem(db as any, inboxItemId);
      await db
        .update(outboxOperations)
        .set({ status: 'failed', attempts: 1 })
        .where(eq(outboxOperations.id, outboxOperationId));
      return { db, inboxItemId, outboxOperationId };
    }
    const group = (reference: string) => ({
      id: '77',
      type: 'transactions',
      attributes: {
        updated_at: '2026-09-27T10:00:00Z',
        transactions: [
          {
            transaction_journal_id: '78',
            internal_reference: reference,
            amount: '30.00',
            currency_code: 'PLN',
            date: '2026-09-27T10:00:00Z',
            type: 'withdrawal',
            description: 'x',
          },
        ],
      },
    });

    it('is recorded as synced when FF3 already has it', async () => {
      const { db, inboxItemId, outboxOperationId } = await failedCreate();
      const request = jest.fn(async (_path: string) => ({
        data: [group(`mmyway:${inboxItemId}`)],
      }));

      const outcome = await discardOperation(
        db as any,
        outboxOperationId,
        async () => ({ request }) as any,
      );

      expect(outcome).toBe('landed');
      expect(request.mock.calls[0]![0]).toContain('internal_reference_is');
      expect(await db.select().from(outboxOperations)).toHaveLength(0);
      const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
      expect(item?.state).toBe('synced');
      expect(item?.ff3GroupId).toBe('77');
    });

    it('goes back to the Inbox when FF3 does not have it', async () => {
      const { db, inboxItemId, outboxOperationId } = await failedCreate();
      const request = jest.fn(async (_path: string) => ({ data: [group('mmyway:someone-else')] }));

      const outcome = await discardOperation(
        db as any,
        outboxOperationId,
        async () => ({ request }) as any,
      );

      expect(outcome).toBe('discarded');
      expect(await db.select().from(outboxOperations)).toHaveLength(0);
      const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
      expect(item?.state).toBe('captured');
    });

    it('is refused, and stays queued, when FF3 cannot be asked', async () => {
      const { db, inboxItemId, outboxOperationId } = await failedCreate();

      const down = await discardOperation(
        db as any,
        outboxOperationId,
        async () =>
          ({
            request: jest.fn(async () => {
              throw new TypeError('Network request failed');
            }),
          }) as any,
      );
      const offline = await discardOperation(db as any, outboxOperationId, async () => null);

      expect([down, offline]).toEqual(['unreachable', 'unreachable']);
      expect(await db.select().from(outboxOperations)).toHaveLength(1);
      const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
      expect(item?.state).toBe('confirmed');
    });

    it('is discarded without asking FF3 when it was never attempted', async () => {
      const { db, outboxOperationId } = await failedCreate();
      await db
        .update(outboxOperations)
        .set({ status: 'pending', attempts: 0 })
        .where(eq(outboxOperations.id, outboxOperationId));
      const resolveClient = jest.fn(async () => null);

      expect(await discardOperation(db as any, outboxOperationId, resolveClient)).toBe('discarded');
      expect(resolveClient).not.toHaveBeenCalled();
    });
  });
});
