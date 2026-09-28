import { readDraft, readReviewJournal, writeDraft } from './draftJson';
import { readPayload, writePayload } from '../sync/payloadJson';

const draft = {
  type: 'withdrawal' as const,
  amount: '12.50',
  currencyCode: 'PLN',
  date: '2026-09-28T10:00:00Z',
  description: 'x',
  isNewPayee: false,
};

describe('draft_json', () => {
  it('stamps a version on write and drops it on read', () => {
    const json = writeDraft(draft);
    expect(JSON.parse(json).v).toBe(1);
    expect(readDraft(json)).toEqual(draft);
  });

  it('reads a draft written before versioning', () => {
    expect(readDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it('refuses a draft that lost a required field, naming it', () => {
    expect(() => readDraft(JSON.stringify({ ...draft, amount: 12.5 }))).toThrow(/amount/);
  });

  it('checks the fields a recurring review relies on', () => {
    expect(
      readReviewJournal(JSON.stringify({ transaction_journal_id: 'j1', updated_at: 'u' }))
        .transaction_journal_id,
    ).toBe('j1');
    expect(() => readReviewJournal('{}')).toThrow(/transaction_journal_id/);
  });
});

describe('payload_json', () => {
  it('round-trips with a version and rejects a payload of the wrong shape', () => {
    const json = writePayload({ groupId: 'g', expectedUpdatedAt: 'u' });
    expect(readPayload('delete_transaction', json)).toEqual({
      groupId: 'g',
      expectedUpdatedAt: 'u',
    });
    expect(() => readPayload('update_account', json)).toThrow(/accountId/);
  });
});
