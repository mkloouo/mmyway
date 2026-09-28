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
      .toEqual({ subject: 'Coffee', route: '/draft/inbox-1', changed: [] });
    expect(describeQueuedChange(op('update_transaction', { groupId: '10', transactionJournalId: '11', expectedUpdatedAt: 'x', changes: {} }), lookups))
      .toEqual({ subject: 'Żabka', route: '/transactions/10', changed: [] });
    expect(describeQueuedChange(op('delete_transaction', { groupId: '10' }), lookups))
      .toEqual({ subject: 'Żabka', route: '/transactions/10', changed: [] });
    expect(describeQueuedChange(op('attach_receipt', { transactionJournalId: '11', receiptImagePath: 'file://r.jpg' }), lookups))
      .toEqual({ subject: 'Żabka', route: '/transactions/10', changed: [] });
    expect(describeQueuedChange(op('update_account', { accountId: '5', order: 2 }), lookups))
      .toEqual({ subject: 'Revolut', route: '/accounts/5', changed: ['inbox.changedOrder'] });
    expect(describeQueuedChange(op('save_planned', {
      key: 'spotify', before: null,
      fields: { name: 'Spotify', type: 'withdrawal', amount: '7.99', currencyCode: 'USD', date: '2026-10-05', repeats: true, frequency: 'monthly', every: 1, tags: [] },
    }), lookups)).toEqual({ subject: 'Spotify', route: '/planned/spotify', changed: [] });
    expect(describeQueuedChange(op('delete_planned', { key: 'spotify', name: 'Spotify' }), lookups))
      .toEqual({ subject: 'Spotify', route: null, changed: [] });
  });

  it('prefers the name an edit is changing to', () => {
    expect(describeQueuedChange(op('update_account', { accountId: '5', edit: { name: 'Revolut EUR' } }), lookups).subject).toBe('Revolut EUR');
  });

  it('says which fields an edit changes, once each', () => {
    const planned = { name: 'Play24', type: 'withdrawal', amount: '60', currencyCode: 'PLN', date: '2026-10-05', repeats: true, frequency: 'monthly', every: 1, tags: [] };
    expect(describeQueuedChange(op('save_planned', {
      key: 'play24', before: planned, fields: { ...planned, date: '2026-10-12', every: 2, frequency: 'weekly' },
    }), lookups).changed).toEqual(['planned.plannedOn', 'planned.frequencyLabel']);
    expect(describeQueuedChange(op('update_transaction', {
      groupId: '10', transactionJournalId: '11', expectedUpdatedAt: 'x', changes: { amount: '5', source_id: '1', source_name: 'PKO' }, splits: [{}],
    }), lookups).changed).toEqual(['fields.amount', 'fields.from', 'splits.split']);
    expect(describeQueuedChange(op('update_account', { accountId: '5', edit: { name: 'Revolut EUR' }, active: false }), lookups).changed)
      .toEqual(['accounts.name', 'accounts.active']);
  });

  it('survives an unreadable payload', () => {
    expect(describeQueuedChange(op('update_account', { nope: true }), lookups)).toEqual({ subject: null, route: null, changed: [] });
  });

  it('collects the transactions the queue points at', () => {
    expect(referencedTransactions([
      op('delete_transaction', { groupId: '10' }),
      op('attach_receipt', { transactionJournalId: '11', receiptImagePath: 'p' }),
    ])).toEqual({ groupIds: ['10'], journalIds: ['11'] });
  });
});
