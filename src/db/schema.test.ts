import { createTestDb, schema } from './client';

describe('db schema', () => {
  it('round-trips a row through every table', async () => {
    const db = createTestDb();
    const now = new Date().toISOString();

    await db.insert(schema.referenceAccounts).values({
      id: 'acc-1', name: 'Cash', type: 'asset', currencyCode: 'PLN', syncedAt: now,
    });
    await db.insert(schema.aliases).values({
      id: 'alias-1', kind: 'payee', normalizedKey: 'zabka', rawInput: 'Żabka',
      targetName: 'Żabka', createdAt: now,
    });
    await db.insert(schema.outboxOperations).values({
      id: 'op-1', kind: 'create_transaction', payloadJson: '{}', status: 'pending',
      createdAt: now, sequence: 1,
    });

    const accounts = await db.select().from(schema.referenceAccounts);
    const aliasRows = await db.select().from(schema.aliases);
    const ops = await db.select().from(schema.outboxOperations);

    expect(accounts).toHaveLength(1);
    expect(aliasRows[0]?.normalizedKey).toBe('zabka');
    expect(ops[0]?.status).toBe('pending');
  });
});
