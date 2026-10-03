import { readPayload } from '../sync/payloadJson';
import { createTestDb } from '../db/testDb';
import { outboxOperations, referenceAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getAccountOrder, setAccountOrder } from '../settings/appSettings';
import { reorderAccounts, updateAccount } from './accountActions';
import { setEnvelopeMarker } from './envelopeMarker';
import { reapplyQueuedAccountEdits } from '../sync/referenceHygiene';

describe('reorderAccounts', () => {
  it('saves positions 1..n locally and queues the whole list as one operation', async () => {
    const db = createTestDb();
    await setAccountOrder(db as any, { a: 1, b: 2, c: 3 });
    await reorderAccounts(db as any, ['b', 'a', 'c']);
    expect(await getAccountOrder(db as any)).toEqual({ b: 1, a: 2, c: 3 });
    const ops = await db.select().from(outboxOperations);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe('reorder_accounts');
    expect(readPayload(ops[0]!.kind, ops[0]!.payloadJson)).toEqual({
      orderedIds: ['b', 'a', 'c'],
    });
  });

  it('queues nothing when the order is unchanged', async () => {
    const db = createTestDb();
    await setAccountOrder(db as any, { a: 1, b: 2 });
    await reorderAccounts(db as any, ['a', 'b']);
    expect(await db.select().from(outboxOperations)).toHaveLength(0);
  });
  it('keeps a queued move over the server order a pull just wrote', async () => {
    const db = createTestDb();
    await reorderAccounts(db as any, ['b', 'a']);
    await setAccountOrder(db as any, { a: 1, b: 2 }); // the pull, before the move reached FF3
    await reapplyQueuedAccountEdits(db as any);
    expect(await getAccountOrder(db as any)).toEqual({ a: 2, b: 1 });
  });
});

describe('updateAccount description', () => {
  async function seed(db: ReturnType<typeof createTestDb>, notes: string | null) {
    await db.insert(referenceAccounts).values({
      id: 'acc-1',
      name: 'Cash',
      type: 'asset',
      currencyCode: 'PLN',
      active: true,
      notes,
      syncedAt: '2026-01-01T00:00:00.000Z',
    } as never);
  }
  const notesOf = async (db: ReturnType<typeof createTestDb>) =>
    (await db.select().from(referenceAccounts).where(eq(referenceAccounts.id, 'acc-1')))[0]!.notes;

  it('changes the description and keeps the envelope marker line', async () => {
    const db = createTestDb();
    await seed(db, 'Old text\nmmyway-envelope');
    await updateAccount(db as any, 'acc-1', {
      notes: setEnvelopeMarker('New text', true),
    });
    expect(await notesOf(db)).toBe('New text\nmmyway-envelope');
    const [op] = await db.select().from(outboxOperations);
    expect(readPayload(op!.kind, op!.payloadJson)).toMatchObject({
      accountId: 'acc-1',
      edit: { notes: 'New text\nmmyway-envelope' },
    });
  });

  it('keeps a queued description over the notes a pull just wrote', async () => {
    const db = createTestDb();
    await seed(db, null);
    await updateAccount(db as any, 'acc-1', { notes: 'Mine' });
    await db.update(referenceAccounts).set({ notes: 'From the server' });
    await reapplyQueuedAccountEdits(db as any);
    expect(await notesOf(db)).toBe('Mine');
  });
});
