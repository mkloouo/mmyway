import { createTestDb } from '../db/testDb';
import { cachedTransactions } from '../db/schema';
import { pullOlderTransactions, pullRecentTransactions } from './pullTransactions';

afterEach(() => jest.useRealTimers());

async function cached(date: string) {
  const db = createTestDb();
  await db.insert(cachedTransactions).values({
    groupId: 'g1',
    journalId: 'j1',
    type: 'withdrawal',
    date,
    amount: '10',
    currencyCode: 'PLN',
    description: 'Coffee',
    updatedAt: 'v1',
    syncedAt: 'now',
  });
  return db;
}

it('keeps the cached calendar day across the autumn DST boundary and bounds both ends', async () => {
  jest.useFakeTimers({ now: new Date('2026-10-28T12:00:00Z') });
  const db = await cached('2026-10-28T00:15:00+01:00');
  const request = jest.fn(async () => ({ data: [] }));
  await pullRecentTransactions(db, { request } as never, 'now');
  expect(request).toHaveBeenCalledWith(
    '/v1/transactions?start=2026-10-14&end=2026-10-28&limit=100&page=1',
  );
});

it('includes the complete previous day when loading older history from a midnight entry', async () => {
  jest.useFakeTimers({ now: new Date('2026-10-28T12:00:00Z') });
  const db = await cached('2026-10-01T00:15:00+02:00');
  const request = jest.fn(async () => ({ data: [], meta: { pagination: { total: 0 } } }));
  await pullOlderTransactions(db, { request } as never, 'now');
  expect(request).toHaveBeenCalledWith(
    '/v1/transactions?start=2026-07-01&end=2026-09-30&limit=100&page=1',
  );
});

it('clamps month subtraction to the end of a shorter month', async () => {
  jest.useFakeTimers({ now: new Date('2026-05-31T12:00:00Z') });
  const request = jest.fn(async () => ({ data: [] }));
  await pullRecentTransactions(createTestDb(), { request } as never, 'now');
  expect(request).toHaveBeenCalledWith(
    '/v1/transactions?start=2026-02-28&end=2026-05-31&limit=100&page=1',
  );
});
