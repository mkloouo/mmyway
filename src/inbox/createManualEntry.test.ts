import { createTestDb } from '../db/testDb';
import { upsertAlias } from '../lookup/aliases';
import * as aliases from '../lookup/aliases';
import { createManualEntry, confirmInboxItem, undoConfirm } from './createManualEntry';
import { outboxOperations, inboxItems, referenceAccounts } from '../db/schema';
import { readPayload } from '../sync/payloadJson';
import { eq } from 'drizzle-orm';

describe('createManualEntry + confirmInboxItem', () => {
  it('flags a merchant with no alias as a new payee and only enqueues after confirm', async () => {
    const db = createTestDb();
    const { inboxItemId, isNewPayee } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '30.00',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'McDonalds',
      merchantRawInput: 'McDonalds',
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
    await upsertAlias(db as any, {
      kind: 'payee',
      rawInput: 'Żabka',
      targetId: 'acc-99',
      targetName: 'Żabka',
    });
    const { isNewPayee } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '15.90',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'snacks',
      merchantRawInput: 'zabka',
    });
    expect(isNewPayee).toBe(false);
  });

  it('puts a deposit payee on the source side, asset account on destination (defect fix)', async () => {
    const db = createTestDb();
    const { draft } = await createManualEntry(db as any, {
      type: 'deposit',
      amount: '2500.00',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'Salary',
      merchantRawInput: 'Employer Inc',
      destinationId: 'acc-cash',
      destinationName: 'Cash',
    });
    expect(draft.sourceName).toBe('Employer Inc');
    expect(draft.destinationId).toBe('acc-cash');
    expect(draft.isNewPayee).toBe(true);
  });

  it('runs no payee alias lookup for a transfer and never flags it a new payee', async () => {
    const db = createTestDb();
    // Even a matching alias for the raw text must be irrelevant — a transfer has no payee.
    await upsertAlias(db as any, {
      kind: 'payee',
      rawInput: 'acc-2',
      targetId: 'should-not-be-used',
      targetName: 'should-not-be-used',
    });
    const matchAliasSpy = jest.spyOn(aliases, 'matchAlias');

    const { draft, isNewPayee } = await createManualEntry(db as any, {
      type: 'transfer',
      amount: '100.00',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'To savings',
      sourceId: 'acc-1',
      destinationId: 'acc-2',
    });

    expect(matchAliasSpy).not.toHaveBeenCalled();
    expect(isNewPayee).toBe(false);
    expect(draft.sourceId).toBe('acc-1');
    expect(draft.destinationId).toBe('acc-2');
    matchAliasSpy.mockRestore();
  });

  it('skips alias matching and forces a new payee when the screen checkbox is set', async () => {
    const db = createTestDb();
    await upsertAlias(db as any, {
      kind: 'payee',
      rawInput: 'Żabka',
      targetId: 'acc-99',
      targetName: 'Żabka',
    });
    const { isNewPayee, draft } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '15.90',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'snacks',
      merchantRawInput: 'zabka',
      forceNewPayee: true,
    });
    expect(isNewPayee).toBe(true);
    expect(draft.destinationId).toBeUndefined();
    expect(draft.destinationName).toBe('zabka');
  });

  it('undo deletes the pending outbox operation and returns the item to its previous state', async () => {
    const db = createTestDb();
    const { inboxItemId } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '30.00',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'McDonalds',
      merchantRawInput: 'McDonalds',
    });
    const confirmed = await confirmInboxItem(db as any, inboxItemId);
    expect(confirmed.previousState).toBe('captured');

    const outcome = await undoConfirm(db as any, inboxItemId, confirmed);
    expect(outcome).toBe('undone');

    const ops = await db.select().from(outboxOperations);
    expect(ops).toHaveLength(0);
    const item = (await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId)))[0];
    expect(item?.state).toBe('captured');
  });

  it('undo is refused once a send was attempted — FF3 may have it — and while it is sending', async () => {
    const db = createTestDb();
    const entry = () =>
      createManualEntry(db as any, {
        type: 'withdrawal',
        amount: '30.00',
        currencyCode: 'PLN',
        date: new Date().toISOString(),
        description: 'McDonalds',
        merchantRawInput: 'McDonalds',
      });
    const retrying = await confirmInboxItem(db as any, (await entry()).inboxItemId);
    await db
      .update(outboxOperations)
      .set({ status: 'failed', attempts: 1, lastError: 'Network request failed' })
      .where(eq(outboxOperations.id, retrying.outboxOperationId));
    const { inboxItemId: sendingId } = await entry();
    const sending = await confirmInboxItem(db as any, sendingId);
    await db
      .update(outboxOperations)
      .set({ status: 'in_flight' })
      .where(eq(outboxOperations.id, sending.outboxOperationId));

    const [retryingItem] = await db.select().from(outboxOperations);
    expect(await undoConfirm(db as any, retryingItem!.inboxItemId!, retrying)).toBe('already_sent');
    expect(await db.select().from(outboxOperations)).toHaveLength(2);
    expect(await undoConfirm(db as any, sendingId, sending)).toBe('already_sent');
  });

  it('undo reports already_sent once the operation is no longer pending', async () => {
    const db = createTestDb();
    const { inboxItemId } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '30.00',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'McDonalds',
      merchantRawInput: 'McDonalds',
    });
    const confirmed = await confirmInboxItem(db as any, inboxItemId);
    await db
      .update(outboxOperations)
      .set({ status: 'done' })
      .where(eq(outboxOperations.id, confirmed.outboxOperationId));

    const outcome = await undoConfirm(db as any, inboxItemId, confirmed);
    expect(outcome).toBe('already_sent');
    const ops = await db.select().from(outboxOperations);
    expect(ops).toHaveLength(1); // untouched
  });
});

// The bug this guards: a 15 EUR receipt paid from a PLN account was queued as "15 EUR" with
// 68.63 PLN as the foreign side. FF3 books `amount` in the asset leg's own currency and ignores
// a currency_code that says otherwise, so it booked 15 zł — the receipt's figure, the account's
// currency, and the real charge lost.
describe('confirmInboxItem puts a foreign entry the right way round for FF3', () => {
  async function seedPlnAccount(db: ReturnType<typeof createTestDb>) {
    await db.insert(referenceAccounts).values({
      id: 'acc-pko',
      name: 'PKO',
      type: 'asset',
      currencyCode: 'PLN',
      active: true,
      syncedAt: '2026-01-01T00:00:00.000Z',
    } as never);
  }
  const queuedSplit = async (db: ReturnType<typeof createTestDb>) => {
    const [op] = await db.select().from(outboxOperations);
    return (readPayload(op!.kind, op!.payloadJson) as { splits: Record<string, unknown>[] })
      .splits[0]!;
  };

  it('a receipt read in EUR, charged in PLN: the PLN charge is the amount', async () => {
    const db = createTestDb();
    await seedPlnAccount(db);
    const { inboxItemId } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '15.00',
      currencyCode: 'EUR',
      date: new Date().toISOString(),
      description: 'LOGINN Hotel',
      merchantRawInput: 'LOGINN Hotel',
      sourceId: 'acc-pko',
      foreignAmount: '68.63',
      foreignCurrencyCode: 'PLN',
    });
    await confirmInboxItem(db as any, inboxItemId);
    expect(await queuedSplit(db)).toMatchObject({
      amount: '68.63',
      currency_code: 'PLN',
      foreign_amount: '15.00',
      foreign_currency_code: 'EUR',
    });
  });

  it("leaves Capture's own entry alone — it already stores the charge as the amount", async () => {
    const db = createTestDb();
    await seedPlnAccount(db);
    const { inboxItemId } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '68.63',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'LOGINN Hotel',
      merchantRawInput: 'LOGINN Hotel',
      sourceId: 'acc-pko',
      foreignAmount: '15.00',
      foreignCurrencyCode: 'EUR',
    });
    await confirmInboxItem(db as any, inboxItemId);
    expect(await queuedSplit(db)).toMatchObject({
      amount: '68.63',
      currency_code: 'PLN',
      foreign_amount: '15.00',
      foreign_currency_code: 'EUR',
    });
  });

  it('an entry in the account currency is sent as it stands', async () => {
    const db = createTestDb();
    await seedPlnAccount(db);
    const { inboxItemId } = await createManualEntry(db as any, {
      type: 'withdrawal',
      amount: '30.00',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'Żabka',
      merchantRawInput: 'Żabka',
      sourceId: 'acc-pko',
    });
    await confirmInboxItem(db as any, inboxItemId);
    expect(await queuedSplit(db)).toMatchObject({ amount: '30.00', currency_code: 'PLN' });
  });
});
