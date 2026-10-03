import {
  fetchJournalAttachments,
  queuedAttachmentDeletes,
  queuedAttachments,
  receiptPreviews,
  type JournalAttachment,
} from './journalAttachments';

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
    expect(result).toEqual([
      { id: '2', filename: 'Receipt', imageSource: null },
      { id: '3', filename: 'c.jpg', imageSource: null },
    ]);
  });

  it('gives image attachments an authenticated download source, and PDFs none', async () => {
    const request = jest.fn().mockResolvedValue({
      data: [
        { id: '1', attributes: { filename: 'r.jpg', mime: 'image/jpeg', attachable_id: '11' } },
        {
          id: '2',
          attributes: { filename: 'r.pdf', mime: 'application/pdf', attachable_id: '11' },
        },
        { id: '3', attributes: { filename: 'r.png', attachable_id: '11' } },
      ],
    });
    const imageSource = (path: string) => ({
      uri: `https://ff3${path}`,
      headers: { Authorization: 'Bearer t' },
    });
    const result = await fetchJournalAttachments({ request, imageSource }, '5', '11');
    expect(result.map((a) => a.imageSource?.uri ?? null)).toEqual([
      'https://ff3/v1/attachments/1/download',
      null,
      'https://ff3/v1/attachments/3/download',
    ]);
  });
});

describe('queuedAttachments', () => {
  it('returns attach_receipt ops for the journal, ignoring others and bad JSON', () => {
    const ops = [
      {
        id: 'a',
        kind: 'attach_receipt',
        status: 'pending',
        payloadJson: '{"transactionJournalId":"11","receiptImagePath":"file:///r.jpg"}',
        lastError: null,
      },
      {
        id: 'b',
        kind: 'attach_receipt',
        status: 'failed',
        payloadJson: '{"transactionJournalId":"12"}',
        lastError: 'x',
      },
      {
        id: 'c',
        kind: 'update_transaction',
        status: 'pending',
        payloadJson: '{"transactionJournalId":"11"}',
        lastError: null,
      },
      { id: 'd', kind: 'attach_receipt', status: 'failed', payloadJson: 'nope', lastError: null },
    ];
    expect(queuedAttachments(ops, '11')).toEqual([
      { opId: 'a', status: 'pending', lastError: null, receiptImagePath: 'file:///r.jpg' },
    ]);
  });
});

describe('receiptPreviews', () => {
  const image = (id: string): JournalAttachment => ({
    id,
    filename: 'receipt.jpg',
    imageSource: { uri: `https://ff3/att/${id}`, headers: {} },
  });
  const keys = (input: Parameters<typeof receiptPreviews>[0]) =>
    receiptPreviews(input).map((p) => p.key);

  it('shows the captured photo from the phone only while FF3 has not answered', () => {
    expect(keys({ queuedPaths: [], capturedPath: 'file:///old.jpg', remote: undefined })).toEqual([
      'file:///old.jpg',
    ]);
    expect(keys({ queuedPaths: [], capturedPath: 'file:///old.jpg', remote: null })).toEqual([
      'file:///old.jpg',
    ]);
  });

  it('shows the new upload, not the deleted captured photo, once FF3 answers', () => {
    // The captured photo's attachment was deleted in FF3; the only attachment left is a new upload.
    expect(
      keys({ queuedPaths: [], capturedPath: 'file:///old.jpg', remote: [image('9')] }),
    ).toEqual(['9']);
  });

  it('shows nothing from the phone when FF3 has no attachments left', () => {
    expect(keys({ queuedPaths: [], capturedPath: 'file:///old.jpg', remote: [] })).toEqual([]);
  });

  it('shows queued uploads from the phone next to what FF3 holds, each once', () => {
    expect(
      keys({
        queuedPaths: ['file:///new.jpg', 'file:///new.jpg'],
        capturedPath: 'file:///new.jpg',
        remote: [image('1')],
      }),
    ).toEqual(['file:///new.jpg', '1']);
  });

  it('leaves out attachments that are not images', () => {
    expect(
      keys({
        queuedPaths: [],
        capturedPath: null,
        remote: [{ id: '2', filename: 'a.pdf', imageSource: null }],
      }),
    ).toEqual([]);
  });
});

describe('a photo with a delete queued (#69)', () => {
  const image = (id: string): JournalAttachment => ({
    id,
    filename: 'receipt.jpg',
    imageSource: { uri: `https://ff3/att/${id}`, headers: {} },
  });
  const payload = (attachmentId: string, journalId: string) =>
    JSON.stringify({ v: 1, attachmentId, transactionJournalId: journalId });

  it('is read out of the outbox for its own journal only', () => {
    const outbox = [
      { kind: 'delete_attachment', payloadJson: payload('1', '10') },
      { kind: 'delete_attachment', payloadJson: payload('2', '11') },
      { kind: 'attach_receipt', payloadJson: '{"v":1}' },
    ];
    expect(queuedAttachmentDeletes(outbox, '10')).toEqual(['1']);
  });

  it('is gone from the thumbnails at once, not at the next pull', () => {
    expect(
      receiptPreviews({
        queuedPaths: [],
        capturedPath: null,
        remote: [image('1'), image('2')],
        deletedIds: ['1'],
      }).map((p) => p.key),
    ).toEqual(['2']);
  });
});
