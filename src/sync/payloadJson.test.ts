import { payloadGroupId, writePayload } from './payloadJson';

describe('payloadGroupId', () => {
  it('reads the group of an edit, a review and a delete', () => {
    const edit = writePayload({ groupId: 'g1', transactionJournalId: 'j1', expectedUpdatedAt: 'x', changes: {} });
    expect(payloadGroupId('update_transaction', edit)).toBe('g1');
    expect(payloadGroupId('recurring_review', writePayload({ groupId: 'g2', transactionJournalId: 'j2', changes: {} }))).toBe('g2');
    expect(payloadGroupId('delete_transaction', writePayload({ groupId: 'g3' }))).toBe('g3');
  });

  it('is null for other kinds', () => {
    expect(payloadGroupId('attach_receipt', writePayload({ transactionJournalId: 'j', receiptImagePath: 'p' }))).toBeNull();
  });

  it('is null instead of throwing for an unreadable payload', () => {
    expect(payloadGroupId('delete_transaction', 'not json')).toBeNull();
    expect(payloadGroupId('delete_transaction', writePayload({ nope: 1 }))).toBeNull();
  });
});
