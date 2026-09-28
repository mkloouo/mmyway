import { createTestDb } from '../db/testDb';
import { outboxOperations, referenceCategories } from '../db/schema';
import { enqueueOperation } from '../sync/outbox';
import { readPayload } from '../sync/payloadJson';
import type { PlannedFields } from './model';
import { replaySavePlanned, type SavePlannedPayload } from './replay';

const fields: PlannedFields = {
  name: 'TEST Spotify',
  type: 'withdrawal',
  sourceId: '1',
  sourceName: 'PKO',
  destinationId: null,
  destinationName: 'Spotify',
  amount: '7.99',
  currencyCode: 'USD',
  notes: 'a note',
  repeats: false,
  frequency: 'monthly',
  every: 1,
  date: '2026-10-05',
  time: '09:30',
  categoryName: 'Music',
  tags: ['sub'],
};

function fakeFF3() {
  return {
    request: jest.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
      const read = (id: string, attributes: Record<string, unknown> = {}) => ({
        data: { id, attributes },
      });
      if (path.startsWith('/v1/search/accounts'))
        return { data: [{ id: '8', attributes: { name: 'Spotify', type: 'expense' } }] };
      if (path.startsWith('/v1/rule-groups'))
        return init?.method === 'POST' ? read('5') : { data: [] };
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
    await db
      .insert(referenceCategories)
      .values({ id: '12', name: 'Music', syncedAt: '2026-09-28T00:00:00Z' });
    const client = fakeFF3();
    await replaySavePlanned(db as any, client as any, 'op-1', {
      key: 'new:1',
      fields,
      before: null,
    });

    const post = client.request.mock.calls.find(([path]) => path === '/v1/recurrences')!;
    const [transaction] = JSON.parse(String((post[1] as RequestInit).body)).transactions;
    expect(transaction).toMatchObject({
      source_id: '1',
      destination_id: '8',
      category_id: '12',
      tags: ['sub'],
    });
    expect(transaction).not.toHaveProperty('destination_name');
    expect(transaction).not.toHaveProperty('category_name');
  });
});

describe('replaySavePlanned on a planned transaction already in FF3', () => {
  const inFF3 = { ...fields, repeats: true, date: '2026-10-05' };
  const ids = { billId: '2', ruleId: '4', recurrenceId: '3' };

  function recordingFF3() {
    const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
    const request = jest.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const read = (id: string, attributes: Record<string, unknown> = {}) => ({
        data: { id, attributes },
      });
      if (path.startsWith('/v1/search/accounts'))
        return { data: [{ id: '8', attributes: { name: 'Spotify', type: 'expense' } }] };
      if (method === 'DELETE') return {};
      if (path === '/v1/categories') return read('12', { name: 'Music' });
      if (path === '/v1/recurrences' && method === 'POST')
        return read('30', { title: fields.name });
      if (path.startsWith('/v1/recurrences/'))
        return read(path.split('/').pop()!, {
          title: fields.name,
          transactions: [{ id: '70' }],
          repetitions: [{ id: '90' }],
        });
      if (path.startsWith('/v1/bills')) return read('2', { name: fields.name });
      if (path.startsWith('/v1/rules/'))
        return read('4', { title: fields.name, triggers: [], actions: [] });
      throw new Error(`no handler for ${method} ${path}`);
    });
    return { client: { request }, calls };
  }

  async function queued(db: ReturnType<typeof createTestDb>, payload: SavePlannedPayload) {
    await enqueueOperation(db as any, { id: 'op-1', kind: 'save_planned', payload });
    const read = async () =>
      readPayload<SavePlannedPayload>(
        'save_planned',
        (await db.select().from(outboxOperations))[0]!.payloadJson,
      );
    return read;
  }

  it('replaces the recurring transaction when the schedule moves: FF3 refuses the new moment on an update', async () => {
    const db = createTestDb();
    const payload: SavePlannedPayload = {
      key: 'testspotify',
      fields: { ...inFF3, date: '2026-10-12' },
      before: inFF3,
      ...ids,
    };
    const stored = await queued(db, payload);
    const { client, calls } = recordingFF3();
    await replaySavePlanned(db as any, client as any, 'op-1', payload);

    const recurrenceCalls = calls
      .filter((c) => c.path.startsWith('/v1/recurrences'))
      .map((c) => `${c.method} ${c.path}`);
    expect(recurrenceCalls).toEqual(['DELETE /v1/recurrences/3', 'POST /v1/recurrences']);
    const created = calls.find((c) => c.method === 'POST' && c.path === '/v1/recurrences')!.body!;
    expect(created).toMatchObject({
      first_date: '2026-10-12',
      repetitions: [{ type: 'monthly', moment: '12' }],
    });
    expect(await stored()).toMatchObject({
      recurrenceId: '30',
      recurrenceReplaced: true,
      replacedRecurrenceIds: [],
    });
  });

  it('does not replace it again on a retry, and sends no schedule to the new one', async () => {
    const db = createTestDb();
    const payload: SavePlannedPayload = {
      key: 'testspotify',
      fields: { ...inFF3, date: '2026-10-12' },
      before: inFF3,
      ...ids,
      recurrenceId: '30',
      recurrenceReplaced: true,
      replacedRecurrenceIds: [],
    };
    await queued(db, payload);
    const { client, calls } = recordingFF3();
    await replaySavePlanned(db as any, client as any, 'op-1', payload);

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/v1/recurrences/30')!.body!;
    expect(put).not.toHaveProperty('repetitions');
  });

  it('finishes deleting the old one when a retry finds it still listed', async () => {
    const db = createTestDb();
    const payload: SavePlannedPayload = {
      key: 'testspotify',
      fields: { ...inFF3, date: '2026-10-12' },
      before: inFF3,
      ...ids,
      recurrenceId: null,
      recurrenceReplaced: true,
      replacedRecurrenceIds: ['3'],
    };
    await queued(db, payload);
    const { client, calls } = recordingFF3();
    await replaySavePlanned(db as any, client as any, 'op-1', payload);
    expect(
      calls.filter((c) => c.path.startsWith('/v1/recurrences')).map((c) => `${c.method} ${c.path}`),
    ).toEqual(['DELETE /v1/recurrences/3', 'POST /v1/recurrences']);
  });

  it('updates in place when the schedule did not change', async () => {
    const db = createTestDb();
    const payload: SavePlannedPayload = {
      key: 'testspotify',
      fields: { ...inFF3, amount: '9.99' },
      before: inFF3,
      ...ids,
    };
    await queued(db, payload);
    const { client, calls } = recordingFF3();
    await replaySavePlanned(db as any, client as any, 'op-1', payload);

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(
      calls.find((c) => c.method === 'PUT' && c.path === '/v1/recurrences/3')!.body,
    ).not.toHaveProperty('repetitions');
  });
});
