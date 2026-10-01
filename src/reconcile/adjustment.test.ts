import { createTestDb } from '../db/testDb';
import {
  createAndConfirmAdjustment,
  DEFAULT_SHORTFALL_PAYEE,
  DEFAULT_SURPLUS_PAYEE,
} from './adjustment';
import { inboxItems, outboxOperations } from '../db/schema';
import { readDraft } from '../inbox/draftJson';
import { readPayload } from '../sync/payloadJson';
import type { CreateTransactionPayload } from '../sync/outbox';

describe('createAndConfirmAdjustment', () => {
  it('creates and confirms a withdrawal adjustment with configured payee id', async () => {
    const db = createTestDb() as any;
    await createAndConfirmAdjustment(
      db,
      {
        accountId: 'acc-wallet',
        currencyCode: 'PLN',
        type: 'withdrawal',
        amount: '10.00',
      },
      {
        shortfallAccountId: 'acc-sf',
        surplusAccountId: 'acc-sp',
        categoryName: 'Reconciliation',
      },
    );

    const items = await db.select().from(inboxItems);
    expect(items).toHaveLength(1);
    expect(items[0].state).toBe('confirmed');

    const draft = readDraft(items[0].draftJson);
    expect(draft.type).toBe('withdrawal');
    expect(draft.amount).toBe('10.00');
    expect(draft.currencyCode).toBe('PLN');
    expect(draft.sourceId).toBe('acc-wallet');
    expect(draft.destinationId).toBe('acc-sf');
    expect(draft.isNewPayee).toBe(false);
    expect(draft.categoryName).toBe('Reconciliation');
    expect(draft.extraTags).toEqual(['mmyway-reconcile']);

    const ops = await db.select().from(outboxOperations);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('create_transaction');
    const payload = readPayload<CreateTransactionPayload>('create_transaction', ops[0].payloadJson);
    expect(payload.splits[0]!.source_id).toBe('acc-wallet');
    expect(payload.splits[0]!.destination_id).toBe('acc-sf');
  });

  it('creates and confirms a deposit adjustment with configured payee id', async () => {
    const db = createTestDb() as any;
    await createAndConfirmAdjustment(
      db,
      {
        accountId: 'acc-wallet',
        currencyCode: 'PLN',
        type: 'deposit',
        amount: '5.00',
      },
      {
        shortfallAccountId: 'acc-sf',
        surplusAccountId: 'acc-sp',
      },
    );

    const items = await db.select().from(inboxItems);
    expect(items).toHaveLength(1);
    const draft = readDraft(items[0].draftJson);
    expect(draft.type).toBe('deposit');
    expect(draft.sourceId).toBe('acc-sp');
    expect(draft.destinationId).toBe('acc-wallet');
    expect(draft.isNewPayee).toBe(false);

    const ops = await db.select().from(outboxOperations);
    const payload = readPayload<CreateTransactionPayload>('create_transaction', ops[0].payloadJson);
    expect(payload.splits[0]!.source_id).toBe('acc-sp');
    expect(payload.splits[0]!.destination_id).toBe('acc-wallet');
  });

  it('falls back to default "Cash shortfall" payee name when no shortfall account id is configured', async () => {
    const db = createTestDb() as any;
    await createAndConfirmAdjustment(
      db,
      {
        accountId: 'acc-wallet',
        currencyCode: 'PLN',
        type: 'withdrawal',
        amount: '15.00',
      },
      {
        shortfallAccountId: null,
        surplusAccountId: null,
      },
    );

    const items = await db.select().from(inboxItems);
    expect(items).toHaveLength(1);
    const draft = readDraft(items[0].draftJson);
    expect(draft.type).toBe('withdrawal');
    expect(draft.sourceId).toBe('acc-wallet');
    expect(draft.destinationId).toBeUndefined();
    expect(draft.destinationName).toBe(DEFAULT_SHORTFALL_PAYEE);
    expect(draft.isNewPayee).toBe(true);

    const ops = await db.select().from(outboxOperations);
    const payload = readPayload<CreateTransactionPayload>('create_transaction', ops[0].payloadJson);
    expect(payload.splits[0]!.source_id).toBe('acc-wallet');
    expect(payload.splits[0]!.destination_name).toBe(DEFAULT_SHORTFALL_PAYEE);
  });

  it('falls back to default "Cash surplus" payee name when no surplus account id is configured', async () => {
    const db = createTestDb() as any;
    await createAndConfirmAdjustment(
      db,
      {
        accountId: 'acc-wallet',
        currencyCode: 'PLN',
        type: 'deposit',
        amount: '20.00',
      },
      {},
    );

    const items = await db.select().from(inboxItems);
    expect(items).toHaveLength(1);
    const draft = readDraft(items[0].draftJson);
    expect(draft.type).toBe('deposit');
    expect(draft.sourceId).toBeUndefined();
    expect(draft.sourceName).toBe(DEFAULT_SURPLUS_PAYEE);
    expect(draft.destinationId).toBe('acc-wallet');
    expect(draft.isNewPayee).toBe(true);

    const ops = await db.select().from(outboxOperations);
    const payload = readPayload<CreateTransactionPayload>('create_transaction', ops[0].payloadJson);
    expect(payload.splits[0]!.source_name).toBe(DEFAULT_SURPLUS_PAYEE);
    expect(payload.splits[0]!.destination_id).toBe('acc-wallet');
  });
});
