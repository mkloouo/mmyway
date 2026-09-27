import { createTestDb } from '../db/testDb';
import { enqueueOperation, replayOutbox } from './outbox';
import { outboxOperations, cachedTransactions } from '../db/schema';

function fakeClient(handlers: Record<string, () => Promise<unknown>>) {
  return {
    request: jest.fn(async (path: string) => {
      const handler = Object.entries(handlers).find(([key]) => path.includes(key));
      if (!handler) throw new Error(`no handler for ${path}`);
      return handler[1]();
    }),
  };
}

describe('replayOutbox', () => {
  it('replays operations in sequence order and stops at the first failure', async () => {
    const db = createTestDb();
    await enqueueOperation(db, { id: 'op-1', kind: 'create_transaction', payload: { clientId: 'c1', splits: [] } });
    await enqueueOperation(db, { id: 'op-2', kind: 'create_transaction', payload: { clientId: 'c2', splits: [] } });
    await enqueueOperation(db, { id: 'op-3', kind: 'create_transaction', payload: { clientId: 'c3', splits: [] } });

    let calls = 0;
    const client = fakeClient({
      '/v1/transactions': async () => {
        calls += 1;
        if (calls === 2) throw new Error('network down');
        return {};
      },
    });

    const result = await replayOutbox(db as any, client as any);

    expect(result.succeeded).toEqual(['op-1']);
    expect(result.failedAt).toBe('op-2');

    const rows = await db.select().from(outboxOperations);
    const op3 = rows.find((r) => r.id === 'op-3');
    expect(op3?.status).toBe('pending'); // never attempted — ordering preserved
  });

  it('flags a stale updated_at as a conflict instead of overwriting', async () => {
    const db = createTestDb();
    await db.insert(cachedTransactions).values({
      groupId: 'g1', journalId: 'j1', type: 'withdrawal', date: '2026-09-01', amount: '10.00',
      currencyCode: 'PLN', description: 'test', tagsJson: '[]', updatedAt: '2026-09-01T00:00:00Z',
      syncedAt: '2026-09-01T00:00:00Z',
    });
    await enqueueOperation(db, {
      id: 'op-1', kind: 'update_transaction',
      payload: { groupId: 'g1', transactionJournalId: 'j1', expectedUpdatedAt: '2026-08-01T00:00:00Z', changes: { amount: '20.00' } },
    });

    const conflicts: unknown[] = [];
    const client = fakeClient({ '/v1/transactions': async () => ({}) });
    const result = await replayOutbox(db as any, client as any, { onConflict: (op, serverUpdatedAt) => conflicts.push({ op, serverUpdatedAt }) });

    expect(result.conflicted).toEqual(['op-1']);
    expect(conflicts).toHaveLength(1);
  });
});
