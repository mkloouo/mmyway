import { FF3RequestError } from '../api/ff3/client';
import { serverUnavailable } from './outbox';
import { OutboxBlocker, subjectsOf } from './outboxSubjects';
import { writePayload } from './payloadJson';

const op = (
  kind: Parameters<typeof subjectsOf>[0]['kind'],
  payload: object,
  inboxItemId: string | null = null,
) => ({
  kind,
  payloadJson: writePayload(payload),
  inboxItemId,
});

describe('subjectsOf', () => {
  it('names what each kind of change touches', () => {
    expect(
      subjectsOf(
        op(
          'create_transaction',
          { clientId: 'c', splits: [{ source_id: '1', destination_id: 9 }] },
          'i1',
        ),
      ),
    ).toEqual(['inbox:i1', 'account:1', 'account:9']);
    expect(
      subjectsOf(
        op('update_transaction', {
          groupId: 'g',
          transactionJournalId: 'j',
          expectedUpdatedAt: 'x',
          changes: { source_id: '2' },
        }),
      ),
    ).toEqual(['group:g', 'journal:j', 'account:2']);
    expect(subjectsOf(op('delete_transaction', { groupId: 'g' }))).toEqual(['group:g']);
    expect(
      subjectsOf(op('attach_receipt', { transactionJournalId: 'j', receiptImagePath: 'p' }, 'i1')),
    ).toEqual(['inbox:i1', 'journal:j']);
    expect(subjectsOf(op('update_account', { accountId: '5', active: true }))).toEqual([
      'account:5',
    ]);
    expect(
      subjectsOf(
        op('save_planned', {
          key: 'spotify',
          before: null,
          billId: '2',
          recurrenceId: '3',
          fields: {
            name: 'Spotify',
            type: 'withdrawal',
            amount: '1',
            currencyCode: 'PLN',
            date: '2026-10-05',
            repeats: true,
            frequency: 'monthly',
            every: 1,
            tags: [],
          },
        }),
      ),
    ).toEqual(['planned:spotify', 'bill:2', 'recurrence:3']);
  });

  it('is null for a payload it cannot read', () => {
    expect(
      subjectsOf({ kind: 'update_account', payloadJson: '{"nope":1}', inboxItemId: null }),
    ).toBeNull();
  });
});

describe('OutboxBlocker', () => {
  it('holds back what shares a subject, and passes the hold down a chain', () => {
    const b = new OutboxBlocker();
    b.block(['group:g']);
    expect(b.waits(['group:g', 'journal:j'])).toBe(true);
    expect(b.waits(['journal:j'])).toBe(false);
    b.block(['group:g', 'journal:j']); // a change waiting behind the failure hands on its subjects
    expect(b.waits(['journal:j'])).toBe(true);
    expect(b.waits(['account:1'])).toBe(false);
  });

  it('holds back everything after an unreadable change, and an unreadable change behind any failure', () => {
    const b = new OutboxBlocker();
    expect(b.waits(null)).toBe(false);
    b.block(['account:1']);
    expect(b.waits(null)).toBe(true);
    b.block(null);
    expect(b.waits(['account:2'])).toBe(true);
    expect(b.blocksEverything).toBe(true);
  });
});

describe('serverUnavailable', () => {
  it('is true when FF3 cannot be reached or refuses everything', () => {
    expect(serverUnavailable(new TypeError('Network request failed'))).toBe(true);
    expect(serverUnavailable(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(
      true,
    );
    for (const status of [500, 503, 401, 403, 429])
      expect(serverUnavailable(new FF3RequestError(status, ''))).toBe(true);
  });

  it("is false for a failure that is the change's own", () => {
    for (const status of [400, 404, 422])
      expect(serverUnavailable(new FF3RequestError(status, ''))).toBe(false);
    expect(serverUnavailable(new Error('receipt image is missing'))).toBe(false);
  });
});
