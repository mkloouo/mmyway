import { draftToTransactionPayload, findDuplicateReceiptItem, type Draft } from './draft';
import { createTestDb } from '../db/testDb';
import { inboxItems } from '../db/schema';

const base: Draft = {
  type: 'withdrawal',
  amount: '21.99',
  currencyCode: 'PLN',
  date: '2026-09-26T10:00:00.000Z',
  description: 'Rossmann',
  destinationName: 'Rossmann',
  isNewPayee: false,
  destinationId: 'acc-42',
};

describe('draftToTransactionPayload', () => {
  it('uses destination_id for a known payee, never destination_name', () => {
    const payload = draftToTransactionPayload('client-1', base);
    expect(payload.splits[0]).toMatchObject({
      destination_id: 'acc-42',
      destination_name: undefined,
    });
  });

  it('uses destination_name only when explicitly flagged as a new payee', () => {
    const payload = draftToTransactionPayload('client-1', {
      ...base,
      isNewPayee: true,
      destinationId: undefined,
    });
    expect(payload.splits[0]).toMatchObject({
      destination_name: 'Rossmann',
      destination_id: undefined,
    });
  });

  it('adds an mmyway-shared tag when sharedWith is set', () => {
    const payload = draftToTransactionPayload('client-1', { ...base, sharedWith: 'alex' });
    expect(payload.splits[0]?.tags).toEqual(['mmyway-shared-alex']);
  });

  it('adds one mmyway-shared tag per name', () => {
    const payload = draftToTransactionPayload('client-1', { ...base, sharedWith: 'alex, Sam' });
    expect(payload.splits[0]?.tags).toEqual(['mmyway-shared-alex', 'mmyway-shared-Sam']);
  });

  it('forwards budget_id for a withdrawal with a budget', () => {
    const payload = draftToTransactionPayload('client-1', { ...base, budgetId: 'budget-7' });
    expect(payload.splits[0]?.budget_id).toBe('budget-7');
  });

  it('forwards foreign amount and currency for a withdrawal (W+FX)', () => {
    const payload = draftToTransactionPayload('client-1', {
      ...base,
      foreignAmount: '5.00',
      foreignCurrencyCode: 'USD',
    });
    expect(payload.splits[0]).toMatchObject({
      foreign_amount: '5.00',
      foreign_currency_code: 'USD',
    });
  });

  it('puts the payee on the source side for a deposit (D), never destination', () => {
    const deposit: Draft = {
      type: 'deposit',
      amount: '2500.00',
      currencyCode: 'PLN',
      date: base.date,
      description: 'Salary',
      sourceName: 'Employer Inc',
      isNewPayee: true,
      destinationId: 'acc-1',
    };
    const payload = draftToTransactionPayload('client-1', deposit);
    expect(payload.splits[0]).toMatchObject({
      source_id: undefined,
      source_name: 'Employer Inc',
      destination_id: 'acc-1',
      destination_name: undefined,
    });
  });

  it('sends both ends as account ids for a transfer (T), with no name fallback', () => {
    const transfer: Draft = {
      type: 'transfer',
      amount: '100.00',
      currencyCode: 'PLN',
      date: base.date,
      description: 'To savings',
      sourceId: 'acc-1',
      destinationId: 'acc-2',
      isNewPayee: false,
    };
    const payload = draftToTransactionPayload('client-1', transfer);
    expect(payload.splits[0]).toMatchObject({
      source_id: 'acc-1',
      source_name: undefined,
      destination_id: 'acc-2',
      destination_name: undefined,
    });
  });

  it('forwards foreign amount and currency for a transfer (T+FX)', () => {
    const transfer: Draft = {
      type: 'transfer',
      amount: '100.00',
      currencyCode: 'PLN',
      date: base.date,
      description: 'To savings',
      sourceId: 'acc-1',
      destinationId: 'acc-2',
      isNewPayee: false,
      foreignAmount: '25.00',
      foreignCurrencyCode: 'EUR',
    };
    const payload = draftToTransactionPayload('client-1', transfer);
    expect(payload.splits[0]).toMatchObject({
      foreign_amount: '25.00',
      foreign_currency_code: 'EUR',
    });
  });
});

describe('findDuplicateReceiptItem', () => {
  it('finds an existing non-error item with the same content hash', async () => {
    const db = createTestDb();
    await db.insert(inboxItems).values({
      id: 'item-1',
      kind: 'receipt',
      state: 'parsed',
      draftJson: '{}',
      receiptContentHash: 'hash-abc',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(await findDuplicateReceiptItem(db as any, 'hash-abc')).toEqual({ id: 'item-1' });
    expect(await findDuplicateReceiptItem(db as any, 'hash-other')).toBeNull();
  });

  it('ignores a matching item that is in the error state (safe to retry)', async () => {
    const db = createTestDb();
    await db.insert(inboxItems).values({
      id: 'item-1',
      kind: 'receipt',
      state: 'error',
      draftJson: '{}',
      receiptContentHash: 'hash-abc',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(await findDuplicateReceiptItem(db as any, 'hash-abc')).toBeNull();
  });
});

describe('a known payee without an id', () => {
  it('is sent by name — a payee picked from history carries no FF3 id', () => {
    const payload = draftToTransactionPayload('client-1', {
      type: 'withdrawal',
      amount: '5.00',
      currencyCode: 'PLN',
      date: '2026-09-27T10:00:00Z',
      description: 'Żabka',
      destinationName: 'Żabka',
      isNewPayee: false,
      sourceId: 'acc-1',
    });
    expect(payload.splits[0]).toMatchObject({
      destination_name: 'Żabka',
      destination_id: undefined,
    });
  });
});
