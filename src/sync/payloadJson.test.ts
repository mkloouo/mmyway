import { logLine } from '../utils/log';
import { payloadGroupId, readPayload, tryReadPayload, writePayload } from './payloadJson';

jest.mock('../utils/log', () => ({ logLine: jest.fn() }));

describe('tryReadPayload', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads a payload like readPayload does, without its version', () => {
    const json = writePayload({ transactionJournalId: 'j1', receiptImagePath: 'file:///r.jpg' });
    expect(tryReadPayload('attach_receipt', json)).toEqual({
      transactionJournalId: 'j1',
      receiptImagePath: 'file:///r.jpg',
    });
    expect(tryReadPayload('attach_receipt', json)).toEqual(readPayload('attach_receipt', json));
  });

  it('is null instead of throwing for text that is not JSON, the wrong shape, or an unknown kind', () => {
    expect(tryReadPayload('attach_receipt', 'nope')).toBeNull();
    expect(tryReadPayload('attach_receipt', '{"transactionJournalId":"j1"}')).toBeNull();
    expect(tryReadPayload('attach_receipt', '[]')).toBeNull();
    expect(tryReadPayload('from_the_future', '{}')).toBeNull();
    expect(tryReadPayload('toString', '{}')).toBeNull();
  });

  it('logs an unreadable payload once, naming the problem and not the values', () => {
    const json = '{"transactionJournalId":"secret-journal-77"}';
    tryReadPayload('attach_receipt', json);
    tryReadPayload('attach_receipt', json);
    tryReadPayload('attach_receipt', '{"description":"Private note" oops');
    expect(logLine).toHaveBeenCalledTimes(2);
    const logged = (logLine as jest.Mock).mock.calls.map(([, message]) => message).join('\n');
    expect(logged).toContain('receiptImagePath');
    expect(logged).not.toContain('secret-journal-77');
    expect(logged).not.toContain('Private note');
  });
});

describe('payloadGroupId', () => {
  it('reads the group of an edit, a review and a delete', () => {
    const edit = writePayload({
      groupId: 'g1',
      transactionJournalId: 'j1',
      expectedUpdatedAt: 'x',
      changes: {},
    });
    expect(payloadGroupId('update_transaction', edit)).toBe('g1');
    expect(
      payloadGroupId(
        'recurring_review',
        writePayload({ groupId: 'g2', transactionJournalId: 'j2', changes: {} }),
      ),
    ).toBe('g2');
    expect(payloadGroupId('delete_transaction', writePayload({ groupId: 'g3' }))).toBe('g3');
  });

  it('is null for other kinds', () => {
    expect(
      payloadGroupId(
        'attach_receipt',
        writePayload({ transactionJournalId: 'j', receiptImagePath: 'p' }),
      ),
    ).toBeNull();
  });

  it('is null instead of throwing for an unreadable payload', () => {
    expect(payloadGroupId('delete_transaction', 'not json')).toBeNull();
    expect(payloadGroupId('delete_transaction', writePayload({ nope: 1 }))).toBeNull();
  });
});
