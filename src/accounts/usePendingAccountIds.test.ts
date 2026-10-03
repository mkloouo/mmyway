import { pendingAccountIds } from './usePendingAccountIds';
import { writePayload } from '../sync/payloadJson';

describe('pendingAccountIds', () => {
  it('collects the accounts named by queued account edits, ignoring other kinds and unreadable payloads', () => {
    const ids = pendingAccountIds([
      { kind: 'update_account', payloadJson: writePayload({ accountId: 'a1', active: false }) },
      { kind: 'update_account', payloadJson: writePayload({ accountId: 'a2', order: 3 }) },
      { kind: 'update_account', payloadJson: '{}' },
      { kind: 'delete_transaction', payloadJson: writePayload({ groupId: 'g1' }) },
    ]);
    expect([...ids].sort()).toEqual(['a1', 'a2']);
  });

  it('a queued reorder names every account it carries', () => {
    const ids = pendingAccountIds([
      { kind: 'reorder_accounts', payloadJson: writePayload({ orderedIds: ['a2', 'a1'] }) },
    ]);
    expect([...ids].sort()).toEqual(['a1', 'a2']);
  });
});
