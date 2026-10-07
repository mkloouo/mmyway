import { schema } from './client';
import { createTestDb } from './testDb';

describe('db schema', () => {
  it('round-trips a row through every table', async () => {
    const db = createTestDb();
    const now = new Date().toISOString();

    await db.insert(schema.referenceAccounts).values({
      id: 'acc-1',
      name: 'Cash',
      type: 'asset',
      currencyCode: 'PLN',
      syncedAt: now,
    });
    await db.insert(schema.outboxOperations).values({
      id: 'op-1',
      kind: 'create_transaction',
      payloadJson: '{}',
      status: 'pending',
      createdAt: now,
      sequence: 1,
    });

    const accounts = await db.select().from(schema.referenceAccounts);
    const ops = await db.select().from(schema.outboxOperations);

    expect(accounts).toHaveLength(1);
    expect(ops[0]?.status).toBe('pending');
  });
});
