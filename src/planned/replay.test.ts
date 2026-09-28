import { createTestDb } from '../db/testDb';
import { referenceCategories } from '../db/schema';
import type { PlannedFields } from './model';
import { replaySavePlanned } from './replay';

const fields: PlannedFields = {
  name: 'TEST Spotify', type: 'withdrawal', sourceId: '1', sourceName: 'PKO', destinationId: null, destinationName: 'Spotify',
  amount: '7.99', currencyCode: 'USD', notes: 'a note', repeats: false, frequency: 'monthly', every: 1,
  date: '2026-10-05', time: '09:30', categoryName: 'Music', tags: ['sub'],
};

function fakeFF3() {
  return {
    request: jest.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
      const read = (id: string, attributes: Record<string, unknown> = {}) => ({ data: { id, attributes } });
      if (path.startsWith('/v1/search/accounts')) return { data: [{ id: '8', attributes: { name: 'Spotify', type: 'expense' } }] };
      if (path.startsWith('/v1/rule-groups')) return init?.method === 'POST' ? read('5') : { data: [] };
      if (path === '/v1/bills') return read('2', { name: fields.name });
      if (path === '/v1/recurrences') return read('3', { title: fields.name });
      if (path === '/v1/rules') return read('4', { title: fields.name });
      throw new Error(`no handler for ${path}`);
    }),
  };
}

describe('replaySavePlanned', () => {
  it('sends the recurring transaction a payee picked by name, and the category, by id', async () => {
    const db = createTestDb();
    await db.insert(referenceCategories).values({ id: '12', name: 'Music', syncedAt: '2026-09-28T00:00:00Z' });
    const client = fakeFF3();
    await replaySavePlanned(db as any, client as any, 'op-1', { key: 'new:1', fields, before: null });

    const post = client.request.mock.calls.find(([path]) => path === '/v1/recurrences')!;
    const [transaction] = JSON.parse(String((post[1] as RequestInit).body)).transactions;
    expect(transaction).toMatchObject({ source_id: '1', destination_id: '8', category_id: '12', tags: ['sub'] });
    expect(transaction).not.toHaveProperty('destination_name');
    expect(transaction).not.toHaveProperty('category_name');
  });
});
