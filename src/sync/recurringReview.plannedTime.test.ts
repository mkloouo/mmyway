import { createTestDb } from '../db/testDb';
import { inboxItems, outboxOperations, plannedObjects } from '../db/schema';
import { approveRecurringReview, pullUnreviewedRecurring } from './recurringReview';
import { readReviewJournal, reviewForeign, writeDraft } from '../inbox/draftJson';

describe('planned time on approval', () => {
  it('moves an approved recurring transaction to the time its recurrence plans', async () => {
    const db = createTestDb();
    await db.insert(plannedObjects).values({
      key: 'recurrence:7',
      kind: 'recurrence',
      ff3Id: '7',
      name: 'Spotify',
      attributesJson: JSON.stringify({ title: 'Spotify', notes: 'mmyway-time: 09:30' }),
      syncedAt: 's',
    });
    await db.insert(inboxItems).values({
      id: 'i1',
      kind: 'recurring_review',
      state: 'confirmed',
      ff3GroupId: 'g1',
      createdAt: 'c',
      updatedAt: 'u',
      draftJson: writeDraft({
        transaction_journal_id: 'j1',
        updated_at: 'v1',
        date: '2026-10-05T00:00:00+02:00',
        recurrence_id: '7',
        tags: [],
      }),
    });
    await approveRecurringReview(db as never, 'i1');
    const [op] = await db.select().from(outboxOperations);
    const date = new Date(JSON.parse(op!.payloadJson).changes.date);
    expect([date.getDate(), date.getHours(), date.getMinutes()]).toEqual([5, 9, 30]);
  });
});

describe('planned currency on pull', () => {
  it('records a recurrence planned in another currency as the review journal foreign amount', async () => {
    const db = createTestDb();
    await db.insert(plannedObjects).values({
      key: 'recurrence:7',
      kind: 'recurrence',
      ff3Id: '7',
      name: 'Spotify',
      attributesJson: JSON.stringify({
        title: 'Spotify',
        transactions: [{ amount: '7.99', currency_code: 'USD' }],
      }),
      syncedAt: 's',
    });
    const client = {
      request: jest.fn(async () => ({
        data: [
          {
            id: 'g1',
            attributes: {
              transactions: [
                {
                  transaction_journal_id: 'j1',
                  recurrence_id: '7',
                  amount: '7.990000000000',
                  currency_code: 'PLN',
                  tags: [],
                },
              ],
            },
          },
        ],
      })),
    };
    await pullUnreviewedRecurring(db as never, client as never);
    const journal = readReviewJournal((await db.select().from(inboxItems))[0]!.draftJson);
    expect(reviewForeign(journal)).toEqual({ amount: '7.99', currencyCode: 'USD' });
  });
});
