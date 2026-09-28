import { createTestDb } from '../db/testDb';
import { outboxOperations } from '../db/schema';
import { enqueueOperation, replayOutbox, retryDelayMs } from './outbox';

describe('retry backoff', () => {
  it('doubles from 30 s and stops at an hour', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(120_000);
    expect(retryDelayMs(20)).toBe(60 * 60 * 1000);
  });

  it('a failed op is not re-sent until its next attempt time, and blocks the ops after it', async () => {
    const db = createTestDb();
    await enqueueOperation(db, { id: 'op-1', kind: 'update_account', payload: { accountId: 'a', active: false } });
    await enqueueOperation(db, { id: 'op-2', kind: 'update_account', payload: { accountId: 'b', active: false } });
    const client = { request: jest.fn(async () => { throw new TypeError('Network request failed'); }) };

    await replayOutbox(db as any, client as any);
    expect(client.request).toHaveBeenCalledTimes(1);
    const [failed] = await db.select().from(outboxOperations).orderBy(outboxOperations.sequence);
    expect(failed).toMatchObject({ status: 'failed', attempts: 1 });
    expect(new Date(failed!.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now());

    const second = await replayOutbox(db as any, client as any);
    expect(second.failedAt).toBe('op-1');
    expect(client.request).toHaveBeenCalledTimes(1); // waited, sent nothing

    await db.update(outboxOperations).set({ status: 'pending' }); // "Retry now"
    await replayOutbox(db as any, client as any);
    expect(client.request).toHaveBeenCalledTimes(2);
  });
});
