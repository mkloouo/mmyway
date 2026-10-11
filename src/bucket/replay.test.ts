import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { bucketObjects, outboxOperations } from '../db/schema';
import { FF3RequestError } from '../api/ff3/client';
import { readPayload, writePayload } from '../sync/payloadJson';
import { bucketRow, cachedLimit } from './objects';
import { replaySetBudgetLimits, replaySetPiggyAmount, type SetBudgetLimitsPayload } from './replay';

const PERIOD = { start: '2026-10-01', end: '2026-10-31' };

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

/**
 * A Firefly III that keeps the limits it is given, and enforces the two rules the replay exists
 * for: a POST for a period that already has a limit is a 422, and `amount` must be above zero.
 */
function fakeFF3(existing: { id: string; budgetId: string; amount: string }[] = []) {
  const limits = existing.map((l) => ({ ...l }));
  const calls: Call[] = [];
  let nextId = 100;
  const request = jest.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
    const method = init?.method ?? 'GET';
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({ method, path, body });
    const budgetId = /\/v1\/budgets\/([^/?]+)\/limits/.exec(path)?.[1];

    if (method === 'GET') {
      return {
        data: limits
          .filter((l) => l.budgetId === budgetId)
          .map((l) => ({
            id: l.id,
            attributes: { budget_id: l.budgetId, amount: l.amount, start: PERIOD.start },
          })),
      };
    }
    if (method === 'POST') {
      if (limits.some((l) => l.budgetId === budgetId))
        throw new FF3RequestError(422, JSON.stringify({ errors: { start: ['limit_exists'] } }));
      const made = { id: String(nextId++), budgetId: budgetId!, amount: String(body!.amount) };
      limits.push(made);
      return { data: { id: made.id, attributes: { ...body, id: made.id, start: PERIOD.start } } };
    }
    if (method === 'PUT') {
      const id = path.split('/').pop()!;
      const found = limits.find((l) => l.id === id)!;
      found.amount = String(body!.amount);
      return {
        data: {
          id,
          attributes: { budget_id: found.budgetId, amount: found.amount, start: PERIOD.start },
        },
      };
    }
    if (method === 'DELETE') {
      const id = path.split('/').pop()!;
      const index = limits.findIndex((l) => l.id === id);
      if (index < 0) throw new FF3RequestError(404, '');
      limits.splice(index, 1);
      return {};
    }
    throw new Error(`no handler for ${method} ${path}`);
  });
  return { request, calls, limits };
}

async function queued(payload: SetBudgetLimitsPayload) {
  const db = createTestDb();
  await db.insert(outboxOperations).values({
    id: 'op-1',
    kind: 'set_budget_limits',
    payloadJson: writePayload(payload),
    status: 'in_flight',
    attempts: 0,
    createdAt: 'c',
    sequence: 1,
  });
  return db;
}

const payloadFor = (entries: SetBudgetLimitsPayload['entries']): SetBudgetLimitsPayload => ({
  periodStart: PERIOD.start,
  periodEnd: PERIOD.end,
  currencyCode: 'PLN',
  entries,
});

function writes(calls: Call[]) {
  return calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.body?.amount]);
}

describe('replaySetBudgetLimits', () => {
  it('creates the limit and records its id, so a retry updates instead of creating a second', async () => {
    const payload = payloadFor([{ budgetId: '1', amount: '800.00' }]);
    const db = await queued(payload);
    const client = fakeFF3();

    await replaySetBudgetLimits(db as never, client as never, 'op-1', payload);

    expect(writes(client.calls)).toEqual([['POST', '/v1/budgets/1/limits', '800.00']]);
    const [op] = await db.select().from(outboxOperations).where(eq(outboxOperations.id, 'op-1'));
    expect(
      readPayload<SetBudgetLimitsPayload>('set_budget_limits', op!.payloadJson).entries[0]!.limitId,
    ).toBe('100');
    // The screen updates off FF3's answer rather than waiting for the next sync.
    expect(await cachedLimit(db as never, '1', PERIOD.start)).toMatchObject({ amount: '800.00' });
  });

  it('converges when its own POST landed and only the answer was lost', async () => {
    // The lost-answer case: the limit is in FF3, the payload never learned its id. A second POST
    // is refused with limit_exists; the replay must read, switch to PUT, and end with ONE limit
    // holding the amount that was asked for.
    const payload = payloadFor([{ budgetId: '1', amount: '800.00' }]);
    const db = await queued(payload);
    const client = fakeFF3([{ id: '55', budgetId: '1', amount: '800.00' }]);

    await expect(
      replaySetBudgetLimits(db as never, client as never, 'op-1', payload),
    ).resolves.toBeUndefined();

    expect(client.limits).toEqual([{ id: '55', budgetId: '1', amount: '800.00' }]);
  });

  it('switches to a PUT when a 422 says the limit already exists', async () => {
    // Same shape, but nothing has been read yet: the cache is empty and the GET is what finds it.
    const payload = payloadFor([{ budgetId: '1', amount: '900.00' }]);
    const db = await queued(payload);
    const client = fakeFF3([{ id: '55', budgetId: '1', amount: '800.00' }]);

    await replaySetBudgetLimits(db as never, client as never, 'op-1', payload);

    expect(client.limits).toEqual([{ id: '55', budgetId: '1', amount: '900.00' }]);
    expect(writes(client.calls)).toEqual([['PUT', '/v1/budgets/1/limits/55', '900.00']]);
  });

  it('sends a move as both writes under one operation', async () => {
    const payload = payloadFor([
      { budgetId: '1', amount: '150.00', limitId: '41' },
      { budgetId: '2', amount: '250.00', limitId: '42' },
    ]);
    const db = await queued(payload);
    const client = fakeFF3([
      { id: '41', budgetId: '1', amount: '200.00' },
      { id: '42', budgetId: '2', amount: '200.00' },
    ]);

    await replaySetBudgetLimits(db as never, client as never, 'op-1', payload);

    expect(writes(client.calls)).toEqual([
      ['PUT', '/v1/budgets/1/limits/41', '150.00'],
      ['PUT', '/v1/budgets/2/limits/42', '250.00'],
    ]);
    // The total across the two envelopes is unchanged: the money moved, it was not created.
    expect(client.limits.map((l) => l.amount)).toEqual(['150.00', '250.00']);
  });

  it('deletes the limit rather than writing a zero FF3 would refuse', async () => {
    const payload = payloadFor([{ budgetId: '1', amount: '0', limitId: '41' }]);
    const db = await queued(payload);
    const client = fakeFF3([{ id: '41', budgetId: '1', amount: '200.00' }]);
    await db
      .insert(bucketObjects)
      .values(
        bucketRow('budget_limit', '1', PERIOD.start, { id: '41', amount: '200.00' }, 'synced'),
      );

    await replaySetBudgetLimits(db as never, client as never, 'op-1', payload);

    expect(writes(client.calls)).toEqual([['DELETE', '/v1/budgets/1/limits/41', undefined]]);
    expect(client.limits).toEqual([]);
    expect(await cachedLimit(db as never, '1', PERIOD.start)).toBeNull();
  });

  it('is a no-op when a delete was already done by an earlier attempt', async () => {
    const payload = payloadFor([{ budgetId: '1', amount: '0', limitId: '41' }]);
    const db = await queued(payload);
    const client = fakeFF3();
    await expect(
      replaySetBudgetLimits(db as never, client as never, 'op-1', payload),
    ).resolves.toBeUndefined();
  });

  it('sends nothing at all when the limit already holds the amount', async () => {
    const payload = payloadFor([{ budgetId: '1', amount: '200.00' }]);
    const db = await queued(payload);
    const client = fakeFF3([{ id: '41', budgetId: '1', amount: '200.00' }]);
    await db
      .insert(bucketObjects)
      .values(
        bucketRow('budget_limit', '1', PERIOD.start, { id: '41', amount: '200.00' }, 'synced'),
      );

    await replaySetBudgetLimits(db as never, client as never, 'op-1', payload);

    expect(writes(client.calls)).toEqual([]);
  });

  it('adopts a limit created in the Firefly III web UI since the last pull', async () => {
    const payload = payloadFor([{ budgetId: '1', amount: '300.00' }]);
    const db = await queued(payload);
    const client = fakeFF3([{ id: '77', budgetId: '1', amount: '120.00' }]);

    await replaySetBudgetLimits(db as never, client as never, 'op-1', payload);

    expect(writes(client.calls)).toEqual([['PUT', '/v1/budgets/1/limits/77', '300.00']]);
  });

  it('lets a failure that is not limit_exists through, so the op fails and retries', async () => {
    const payload = payloadFor([{ budgetId: '1', amount: '300.00' }]);
    const db = await queued(payload);
    const client = {
      request: jest.fn(async (path: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'GET') return { data: [] };
        throw new FF3RequestError(500, 'boom');
      }),
    };
    await expect(
      replaySetBudgetLimits(db as never, client as never, 'op-1', payload),
    ).rejects.toThrow(FF3RequestError);
  });
});

describe('replaySetPiggyAmount', () => {
  function piggyFF3(attributes: Record<string, unknown>) {
    const calls: Call[] = [];
    const request = jest.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
      const method = init?.method ?? 'GET';
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ method, path, body });
      if (method === 'GET') return { data: { id: '7', attributes } };
      const sent = (body!.accounts as { current_amount: string }[])[0]!;
      return {
        data: { id: '7', attributes: { ...attributes, current_amount: sent.current_amount } },
      };
    });
    return { request, calls };
  }

  const saved = (calls: Call[]) =>
    (
      calls.find((c) => c.method === 'PUT')?.body?.accounts as
        { account_id: string; current_amount: string }[] | undefined
    )?.[0];

  it('sends the absolute amount through accounts[], the only form that can empty a fund', async () => {
    const db = createTestDb();
    const client = piggyFF3({ name: 'New laptop', current_amount: '300.00', target_amount: '0' });

    await replaySetPiggyAmount(db as never, client as never, {
      piggyId: '7',
      accountId: '5',
      amount: '0',
    });

    // The top-level current_amount is IsValidPositiveAmount (> 0) and could never store this.
    expect(saved(client.calls)).toEqual({ account_id: '5', current_amount: '0' });
    expect(client.calls.find((c) => c.method === 'PUT')!.body).not.toHaveProperty('current_amount');
  });

  it('clamps to the target, because FF3 would clamp it silently', async () => {
    const db = createTestDb();
    const client = piggyFF3({ name: 'F', current_amount: '100.00', target_amount: '500.00' });

    await replaySetPiggyAmount(db as never, client as never, {
      piggyId: '7',
      accountId: '5',
      amount: '900.00',
    });

    expect(saved(client.calls)!.current_amount).toBe('500.00');
  });

  it('does not clamp an open-ended fund, whose target_amount is 0', async () => {
    const db = createTestDb();
    const client = piggyFF3({ name: 'F', current_amount: '0', target_amount: '0' });

    await replaySetPiggyAmount(db as never, client as never, {
      piggyId: '7',
      accountId: '5',
      amount: '900.00',
    });

    expect(saved(client.calls)!.current_amount).toBe('900.00');
  });

  it('refuses to overwrite a fund changed in Firefly III since the edit began', async () => {
    const db = createTestDb();
    const client = piggyFF3({ name: 'New laptop', current_amount: '300.00', updated_at: 'now' });

    await expect(
      replaySetPiggyAmount(db as never, client as never, {
        piggyId: '7',
        accountId: '5',
        amount: '400.00',
        expectedUpdatedAt: 'then',
      }),
    ).rejects.toThrow(/New laptop changed in Firefly III/);
    // Nothing was written: a conflict is a message, not an overwrite.
    expect(client.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('goes ahead when the fund has not changed, and caches what FF3 answered', async () => {
    const db = createTestDb();
    const client = piggyFF3({ name: 'F', current_amount: '300.00', updated_at: 'same' });

    await replaySetPiggyAmount(db as never, client as never, {
      piggyId: '7',
      accountId: '5',
      amount: '400.00',
      expectedUpdatedAt: 'same',
    });

    expect(saved(client.calls)!.current_amount).toBe('400.00');
    const [row] = await db.select().from(bucketObjects);
    expect(JSON.parse(row!.attributesJson).current_amount).toBe('400.00');
  });
});
