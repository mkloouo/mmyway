import { draftToTransactionPayload, findDuplicateReceiptItem, type Draft } from './draft';
import { createTestDb } from '../db/testDb';
import { inboxItems } from '../db/schema';

const base: Draft = {
  type: 'withdrawal', amount: '21.99', currencyCode: 'PLN', date: '2026-09-26T10:00:00.000Z',
  description: 'Rossmann', destinationName: 'Rossmann', isNewPayee: false, destinationId: 'acc-42',
};

describe('draftToTransactionPayload', () => {
  it('uses destination_id for a known payee, never destination_name', () => {
    const payload = draftToTransactionPayload('client-1', base);
    expect(payload.splits[0]).toMatchObject({ destination_id: 'acc-42', destination_name: undefined });
  });

  it('uses destination_name only when explicitly flagged as a new payee', () => {
    const payload = draftToTransactionPayload('client-1', { ...base, isNewPayee: true, destinationId: undefined });
    expect(payload.splits[0]).toMatchObject({ destination_name: 'Rossmann', destination_id: undefined });
  });

  it('adds an mmyway-shared tag when sharedWith is set', () => {
    const payload = draftToTransactionPayload('client-1', { ...base, sharedWith: 'alex' });
    expect(payload.splits[0]?.tags).toEqual(['mmyway-shared-alex']);
  });
});

describe('findDuplicateReceiptItem', () => {
  it('finds an existing non-error item with the same content hash', async () => {
    const db = createTestDb();
    await db.insert(inboxItems).values({
      id: 'item-1', kind: 'receipt', state: 'parsed', draftJson: '{}', receiptContentHash: 'hash-abc',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    expect(await findDuplicateReceiptItem(db as any, 'hash-abc')).toEqual({ id: 'item-1' });
    expect(await findDuplicateReceiptItem(db as any, 'hash-other')).toBeNull();
  });

  it('ignores a matching item that is in the error state (safe to retry)', async () => {
    const db = createTestDb();
    await db.insert(inboxItems).values({
      id: 'item-1', kind: 'receipt', state: 'error', draftJson: '{}', receiptContentHash: 'hash-abc',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    expect(await findDuplicateReceiptItem(db as any, 'hash-abc')).toBeNull();
  });
});
