import { fetchJournalAttachments, queuedAttachments } from './journalAttachments';

describe('fetchJournalAttachments', () => {
  it('asks FF3 for the group and keeps only this journal', async () => {
    const request = jest.fn().mockResolvedValue({
      data: [
        { id: '1', attributes: { filename: 'a.jpg', attachable_id: '10' } },
        { id: '2', attributes: { filename: 'b.jpg', title: 'Receipt', attachable_id: 11 } },
        { id: '3', attributes: { filename: 'c.jpg', attachable_id: '11' } },
      ],
    });
    const result = await fetchJournalAttachments({ request }, '5', '11');
    expect(request).toHaveBeenCalledWith('/v1/transactions/5/attachments');
    expect(result).toEqual([{ id: '2', filename: 'Receipt' }, { id: '3', filename: 'c.jpg' }]);
  });
});

describe('queuedAttachments', () => {
  it('returns attach_receipt ops for the journal, ignoring others and bad JSON', () => {
    const ops = [
      { id: 'a', kind: 'attach_receipt', status: 'pending', payloadJson: '{"transactionJournalId":"11"}', lastError: null },
      { id: 'b', kind: 'attach_receipt', status: 'failed', payloadJson: '{"transactionJournalId":"12"}', lastError: 'x' },
      { id: 'c', kind: 'update_transaction', status: 'pending', payloadJson: '{"transactionJournalId":"11"}', lastError: null },
      { id: 'd', kind: 'attach_receipt', status: 'failed', payloadJson: 'nope', lastError: null },
    ];
    expect(queuedAttachments(ops, '11')).toEqual([{ opId: 'a', status: 'pending', lastError: null }]);
  });
});
