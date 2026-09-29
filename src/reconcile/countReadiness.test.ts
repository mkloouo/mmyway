import { createTestDb } from '../db/testDb';
import { countBlocker, describeCountBlocker, readCountBlocker } from './countReadiness';
import { enqueueOperation } from '../sync/outbox';
import { setBalancesStale } from '../settings/appSettings';

describe('countBlocker', () => {
  it('allows the count with nothing queued and fresh balances', () => {
    expect(countBlocker(0, false)).toBeNull();
  });

  it('blocks while a write is queued, before looking at the balances', () => {
    expect(countBlocker(2, true)).toEqual({ reason: 'queued', count: 2 });
  });

  it('blocks when the balances were read before the last write landed', () => {
    expect(countBlocker(0, true)).toEqual({ reason: 'stale_balances' });
  });

  it('says how many changes are waiting', () => {
    expect(describeCountBlocker({ reason: 'queued', count: 1 })).toMatch(/^1 change hasn't/);
    expect(describeCountBlocker({ reason: 'queued', count: 3 })).toMatch(/^3 changes haven't/);
  });
});

describe('readCountBlocker', () => {
  it('counts queued transaction writes but not receipt uploads or account edits', async () => {
    const db = createTestDb() as any;
    await enqueueOperation(db, {
      id: 'r',
      kind: 'attach_receipt',
      payload: { transactionJournalId: 'j', receiptImagePath: 'file:///x.jpg' },
    });
    await enqueueOperation(db, {
      id: 'a',
      kind: 'update_account',
      payload: { accountId: 'a1', active: false },
    });
    expect(await readCountBlocker(db)).toBeNull();

    await enqueueOperation(db, {
      id: 'c',
      kind: 'create_transaction',
      payload: { clientId: 'c', splits: [] },
    });
    await enqueueOperation(db, { id: 'd', kind: 'delete_transaction', payload: { groupId: 'g' } });
    expect(await readCountBlocker(db)).toEqual({ reason: 'queued', count: 2 });
  });

  it('reads the stale-balances mark', async () => {
    const db = createTestDb() as any;
    await setBalancesStale(db, true);
    expect(await readCountBlocker(db)).toEqual({ reason: 'stale_balances' });
    await setBalancesStale(db, false);
    expect(await readCountBlocker(db)).toBeNull();
  });
});
