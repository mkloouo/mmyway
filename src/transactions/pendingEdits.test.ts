import { pendingEdits, applyPendingEdit } from './pendingEdits';

let seq = 0;
function op(kind: string, payload: object, status = 'pending', lastError: string | null = null) {
  seq += 1;
  return { kind, status, lastError, sequence: seq, payloadJson: JSON.stringify(payload) };
}

const row = { groupId: 'g1', journalId: 'j1', description: 'Lidl', amount: '10.00', categoryName: 'Groceries' };

describe('pendingEdits', () => {
  it('merges queued updates to the same transaction in replay order', () => {
    const edits = pendingEdits([
      op('update_transaction', { groupId: 'g1', changes: { amount: '12.00', category_name: 'Food' } }),
      op('recurring_review', { groupId: 'g1', changes: { amount: '15.00' } }),
      op('create_transaction', { clientId: 'c', splits: [] }),
      op('delete_transaction', { groupId: 'g2' }),
    ]);
    expect(edits.byGroup.get('g1')).toEqual({ status: 'queued', changes: { amount: '15.00', category_name: 'Food' } });
    expect(edits.byGroup.has('g2')).toBe(false);
  });

  it('reports the worst status across a transaction\'s ops', () => {
    const edits = pendingEdits([
      op('update_transaction', { groupId: 'g1', changes: {} }, 'failed', 'conflict'),
      op('update_transaction', { groupId: 'g1', changes: {} }),
      op('update_transaction', { groupId: 'g2', changes: {} }, 'failed', 'network down'),
    ]);
    expect(edits.byGroup.get('g1')?.status).toBe('conflict');
    expect(edits.byGroup.get('g2')?.status).toBe('failed');
  });

  it('ignores ops with unreadable payloads', () => {
    const edits = pendingEdits([{ kind: 'update_transaction', status: 'pending', lastError: null, sequence: 1, payloadJson: 'nope' }]);
    expect(edits.byGroup.size).toBe(0);
  });
});

describe('applyPendingEdit', () => {
  it('returns null for a row with nothing queued', () => {
    expect(applyPendingEdit(row, pendingEdits([]))).toBeNull();
  });

  it('shows the queued values on the row', () => {
    const edits = pendingEdits([op('update_transaction', { groupId: 'g1', changes: { amount: '12.00', category_name: 'Food' } })]);
    expect(applyPendingEdit(row, edits)).toEqual({
      status: 'queued', row: { ...row, amount: '12.00', categoryName: 'Food' },
    });
  });

  it('marks a row with only a queued receipt upload, values unchanged', () => {
    const edits = pendingEdits([op('attach_receipt', { transactionJournalId: 'j1', receiptImagePath: 'file:///r.jpg' })]);
    expect(applyPendingEdit(row, edits)).toEqual({ status: 'queued', row });
  });
});
