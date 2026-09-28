import { readPayload } from '../sync/payloadJson';
import { createTestDb } from '../db/testDb';
import { outboxOperations } from '../db/schema';
import { getAccountOrder, setAccountOrder } from '../settings/appSettings';
import { reorderAccounts } from './accountActions';
import { reapplyQueuedAccountEdits } from '../sync/referenceHygiene';

describe('reorderAccounts', () => {
  it('saves positions 1..n locally and queues an FF3 update only for accounts that moved', async () => {
    const db = createTestDb();
    await setAccountOrder(db as any, { a: 1, b: 2, c: 3 });
    await reorderAccounts(db as any, ['b', 'a', 'c']);
    expect(await getAccountOrder(db as any)).toEqual({ b: 1, a: 2, c: 3 });
    const payloads = (await db.select().from(outboxOperations)).map((op) =>
      readPayload(op.kind, op.payloadJson),
    );
    expect(payloads).toEqual([
      { accountId: 'b', order: 1 },
      { accountId: 'a', order: 2 },
    ]);
  });
  it('keeps a queued move over the server order a pull just wrote', async () => {
    const db = createTestDb();
    await reorderAccounts(db as any, ['b', 'a']);
    await setAccountOrder(db as any, { a: 1, b: 2 }); // the pull, before the move reached FF3
    await reapplyQueuedAccountEdits(db as any);
    expect(await getAccountOrder(db as any)).toEqual({ a: 2, b: 1 });
  });
});
