import { describeQueuedChange, referencedTransactions } from './queuedChanges';

const lookups = {
  accountName: (id: string) => (id === '5' ? 'Revolut' : undefined),
  transaction: (ref: { groupId?: string; journalId?: string }) =>
    (ref.groupId === '10' || ref.journalId === '11' ? { groupId: '10', description: 'Żabka' } : undefined),
};
const op = (kind: Parameters<typeof describeQueuedChange>[0]['kind'], payload: object, inboxItemId: string | null = null) =>
  ({ kind, payloadJson: JSON.stringify(payload), inboxItemId });

describe('describeQueuedChange', () => {
  it('names each kind of change and where it opens', () => {
    expect(describeQueuedChange(op('create_transaction', { clientId: 'c', splits: [{ description: 'Coffee' }] }, 'inbox-1'), lookups))
      .toEqual({ subject: 'Coffee', route: '/draft/inbox-1' });
    expect(describeQueuedChange(op('update_transaction', { groupId: '10', transactionJournalId: '11', expectedUpdatedAt: 'x', changes: {} }), lookups))
      .toEqual({ subject: 'Żabka', route: '/transactions/10' });
    expect(describeQueuedChange(op('delete_transaction', { groupId: '10' }), lookups))
      .toEqual({ subject: 'Żabka', route: '/transactions/10' });
    expect(describeQueuedChange(op('attach_receipt', { transactionJournalId: '11', receiptImagePath: 'file://r.jpg' }), lookups))
      .toEqual({ subject: 'Żabka', route: '/transactions/10' });
    expect(describeQueuedChange(op('update_account', { accountId: '5', order: 2 }), lookups))
      .toEqual({ subject: 'Revolut', route: '/accounts/5' });
    expect(describeQueuedChange(op('save_planned', {
      key: 'spotify', before: null,
      fields: { name: 'Spotify', type: 'withdrawal', amount: '7.99', currencyCode: 'USD', date: '2026-10-05', repeats: true, frequency: 'monthly', every: 1, tags: [] },
    }), lookups)).toEqual({ subject: 'Spotify', route: '/planned/spotify' });
    expect(describeQueuedChange(op('delete_planned', { key: 'spotify', name: 'Spotify' }), lookups))
      .toEqual({ subject: 'Spotify', route: null });
  });

  it('prefers the name an edit is changing to', () => {
    expect(describeQueuedChange(op('update_account', { accountId: '5', edit: { name: 'Revolut EUR' } }), lookups).subject).toBe('Revolut EUR');
  });

  it('survives an unreadable payload', () => {
    expect(describeQueuedChange(op('update_account', { nope: true }), lookups)).toEqual({ subject: null, route: null });
  });

  it('collects the transactions the queue points at', () => {
    expect(referencedTransactions([
      op('delete_transaction', { groupId: '10' }),
      op('attach_receipt', { transactionJournalId: '11', receiptImagePath: 'p' }),
    ])).toEqual({ groupIds: ['10'], journalIds: ['11'] });
  });
});
