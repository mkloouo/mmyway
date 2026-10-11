import { createTestDb } from '../db/testDb';
import { inboxItems, outboxOperations, plannedObjects } from '../db/schema';
import { pullUnreviewedRecurring } from './recurringReview';

/**
 * Base Firefly III has no way to miss a single occurrence — `active: false` pauses the whole
 * recurrence — so the Planned tab records the skipped date in the recurring transaction's notes
 * and the app deletes the transaction the moment FF3 books it. Nothing is pre-triggered: the
 * `recurrence_date` meta is soft-deleted with the journal, so a future date booked early and
 * deleted would simply be booked again on the day.
 */
async function withRecurrence(notes: string) {
  const db = createTestDb();
  await db.insert(plannedObjects).values({
    key: 'recurrence:7',
    kind: 'recurrence',
    ff3Id: '7',
    name: 'Spotify',
    attributesJson: JSON.stringify({ title: 'Spotify', notes }),
    syncedAt: 's',
  });
  return db;
}

function clientWith(journal: Record<string, unknown>) {
  return {
    request: jest.fn(async () => ({
      data: [{ id: 'g1', attributes: { updated_at: 'v1', transactions: [journal] } }],
    })),
  };
}

const booked = {
  transaction_journal_id: 'j1',
  recurrence_id: '7',
  description: 'Spotify',
  amount: '7.99',
  currency_code: 'PLN',
  date: '2026-11-05T00:00:00+01:00',
  tags: [],
};

describe('a skipped occurrence', () => {
  it('is deleted on arrival instead of becoming a review card', async () => {
    const db = await withRecurrence('mmyway-time: 09:30 mmyway-skip: 2026-11-05');
    const created = await pullUnreviewedRecurring(db as never, clientWith(booked) as never);

    expect(created).toBe(0);
    expect(await db.select().from(inboxItems)).toHaveLength(0);
    const ops = await db.select().from(outboxOperations);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe('delete_transaction');
    expect(JSON.parse(ops[0]!.payloadJson)).toMatchObject({
      groupId: 'g1',
      expectedUpdatedAt: 'v1',
    });
  });

  it('matches on the occurrence FF3 recorded, not the day it ran', async () => {
    // `recurrence_date` is the occurrence; the journal's own date is only the fallback.
    const db = await withRecurrence('mmyway-skip: 2026-11-05');
    const ran = { ...booked, date: '2026-11-06T00:00:00+01:00', recurrence_date: '2026-11-05' };
    await pullUnreviewedRecurring(db as never, clientWith(ran) as never);
    expect(await db.select().from(inboxItems)).toHaveLength(0);
    expect(await db.select().from(outboxOperations)).toHaveLength(1);
  });

  it('is queued once however often the pull repeats', async () => {
    const db = await withRecurrence('mmyway-skip: 2026-11-05');
    const client = clientWith(booked);
    await pullUnreviewedRecurring(db as never, client as never);
    await pullUnreviewedRecurring(db as never, client as never);
    expect(await db.select().from(outboxOperations)).toHaveLength(1);
  });
});

describe('an occurrence that was not skipped', () => {
  it('still becomes a review card', async () => {
    const db = await withRecurrence('mmyway-skip: 2026-12-05');
    const created = await pullUnreviewedRecurring(db as never, clientWith(booked) as never);

    expect(created).toBe(1);
    expect(await db.select().from(inboxItems)).toHaveLength(1);
    expect(await db.select().from(outboxOperations)).toHaveLength(0);
  });

  it('still becomes a review card when nothing is skipped at all', async () => {
    const db = await withRecurrence('mmyway-time: 09:30');
    expect(await pullUnreviewedRecurring(db as never, clientWith(booked) as never)).toBe(1);
    expect(await db.select().from(outboxOperations)).toHaveLength(0);
  });
});
