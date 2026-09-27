import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { referenceAccounts, referenceCategories } from '../db/schema';
import { enqueueOperation } from './outbox';
import { pruneReferenceData, reapplyQueuedAccountEdits } from './referenceHygiene';

function account(id: string, syncedAt: string, extra: Partial<typeof referenceAccounts.$inferInsert> = {}) {
  return { id, name: id, type: 'asset', currencyCode: 'PLN', active: true, syncedAt, ...extra };
}

describe('pruneReferenceData', () => {
  it('drops rows the latest pull did not return', async () => {
    const db = createTestDb();
    await db.insert(referenceAccounts).values([account('kept', '2026-09-27T10:00:01Z'), account('deleted-in-ff3', '2026-09-20T00:00:00Z')]);
    await pruneReferenceData(db as any, '2026-09-27T10:00:00Z');
    expect((await db.select().from(referenceAccounts)).map((a) => a.id)).toEqual(['kept']);
  });
  it('leaves a table alone when the pull wrote nothing to it', async () => {
    const db = createTestDb();
    await db.insert(referenceCategories).values({ id: 'c1', name: 'Groceries', syncedAt: '2026-09-20T00:00:00Z' });
    await pruneReferenceData(db as any, '2026-09-27T10:00:00Z');
    expect(await db.select().from(referenceCategories)).toHaveLength(1);
  });
});

describe('reapplyQueuedAccountEdits', () => {
  it('keeps a queued active/envelope edit over the server copy the pull just wrote', async () => {
    const db = createTestDb();
    await db.insert(referenceAccounts).values(account('a1', '2026-09-27T10:00:01Z', { notes: 'server note' }));
    await enqueueOperation(db, { id: 'op-1', kind: 'update_account', payload: { accountId: 'a1', active: false } });
    await enqueueOperation(db, { id: 'op-2', kind: 'update_account', payload: { accountId: 'a1', setEnvelopeMarker: true } });
    await reapplyQueuedAccountEdits(db as any);
    const [row] = await db.select().from(referenceAccounts).where(eq(referenceAccounts.id, 'a1'));
    expect(row).toMatchObject({ active: false, notes: 'server note\nmmyway-envelope' });
  });
});
