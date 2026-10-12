import { createTestDb } from '../db/testDb';
import { outboxOperations, plannedObjects } from '../db/schema';
import { FF3RequestError } from '../api/ff3/client';
import { enqueueOperation } from '../sync/outbox';
import { readPayload } from '../sync/payloadJson';
import { plannedKey } from '../planned/objects';
import {
  replayCreateRule,
  replayToggleRule,
  replayToggleRuleGroup,
  replayTriggerRule,
  type CreateRulePayload,
} from './replay';

const today = new Date(2026, 9, 12); // 12 Oct 2026, local

function fakeFF3(answer: (path: string, init?: RequestInit) => unknown) {
  return { request: jest.fn(async (path: string, init?: RequestInit) => answer(path, init)) };
}

const ruleRow = (attributes: Record<string, unknown>) => ({
  key: plannedKey('rule', '4'),
  kind: 'rule' as const,
  ff3Id: '4',
  name: 'Coffee',
  attributesJson: JSON.stringify(attributes),
  syncedAt: '2026-10-01T00:00:00Z',
});

describe('toggle replays', () => {
  it('PUTs the rule active flag and stores FF3 answer in the cache', async () => {
    const db = createTestDb();
    await db.insert(plannedObjects).values(ruleRow({ title: 'Coffee', active: true }));
    const client = fakeFF3(() => ({
      data: { id: '4', attributes: { title: 'Coffee', active: false } },
    }));

    await replayToggleRule(db as any, client as any, { ruleId: '4', active: false });

    expect(client.request).toHaveBeenCalledWith('/v1/rules/4', {
      method: 'PUT',
      body: JSON.stringify({ active: false }),
    });
    const [row] = await db.select().from(plannedObjects);
    expect(JSON.parse(row!.attributesJson)).toEqual({ title: 'Coffee', active: false });
  });

  it('removes a rule FF3 no longer has, without failing the operation', async () => {
    const db = createTestDb();
    await db.insert(plannedObjects).values(ruleRow({ title: 'Coffee', active: true }));
    const client = fakeFF3(() => {
      throw new FF3RequestError(404, '{}', 'PUT /v1/rules/4');
    });

    await replayToggleRule(db as any, client as any, { ruleId: '4', active: true });
    expect(await db.select().from(plannedObjects)).toHaveLength(0);
  });

  it('PUTs the rule group active flag', async () => {
    const db = createTestDb();
    const client = fakeFF3(() => ({
      data: { id: '9', attributes: { title: 'Planned', active: false } },
    }));

    await replayToggleRuleGroup(db as any, client as any, { ruleGroupId: '9', active: false });

    expect(client.request).toHaveBeenCalledWith('/v1/rule-groups/9', {
      method: 'PUT',
      body: JSON.stringify({ active: false }),
    });
  });
});

describe('replayTriggerRule', () => {
  it('runs the rule over the year up to today', async () => {
    const client = fakeFF3(() => ({}));
    await replayTriggerRule(client as any, { ruleId: '4' }, today);
    expect(client.request).toHaveBeenCalledWith(
      '/v1/rules/4/trigger?start=2025-10-12&end=2026-10-12',
      { method: 'POST' },
    );
  });

  it('is done when the rule is gone', async () => {
    const client = fakeFF3(() => {
      throw new FF3RequestError(404, '{}', 'POST /v1/rules/4/trigger');
    });
    await expect(replayTriggerRule(client as any, { ruleId: '4' }, today)).resolves.toBeUndefined();
  });

  it('rethrows other failures so the operation retries', async () => {
    const client = fakeFF3(() => {
      throw new FF3RequestError(500, '{}', 'POST /v1/rules/4/trigger');
    });
    await expect(replayTriggerRule(client as any, { ruleId: '4' }, today)).rejects.toThrow();
  });
});

describe('replayCreateRule', () => {
  const payload: CreateRulePayload = {
    clientId: 'mmyway-abc',
    title: 'Coffee',
    triggers: [{ type: 'description_contains', value: 'Coffee' }],
    actions: [{ type: 'set_category', value: 'Food' }],
  };

  const planned = (method?: string) =>
    method === 'POST' ? { data: { id: '77', attributes: { title: 'Coffee' } } } : null;

  it('creates the rule in the Planned group and records its id before storing it', async () => {
    const db = createTestDb();
    await enqueueOperation(db as any, { id: 'op-1', kind: 'create_rule', payload });
    const client = fakeFF3((path, init) => {
      if (path.startsWith('/v1/rule-groups')) {
        return init?.method === 'POST' ? { data: { id: '5', attributes: {} } } : { data: [] };
      }
      if (path === '/v1/rules' && init?.method === 'POST') return planned('POST');
      throw new Error(`no handler for ${path}`);
    });

    await replayCreateRule(db as any, client as any, 'op-1', payload);

    const post = client.request.mock.calls.find(
      ([path, init]) => path === '/v1/rules' && init?.method === 'POST',
    )!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({
      title: 'Coffee',
      rule_group_id: '5',
      trigger: 'store-journal',
      active: true,
      strict: true,
      stop_processing: false,
    });
    const [op] = await db.select().from(outboxOperations);
    expect(readPayload<CreateRulePayload>('create_rule', op!.payloadJson).serverId).toBe('77');
  });

  it('adopts a rule an earlier attempt already made instead of posting a second one', async () => {
    const db = createTestDb();
    await enqueueOperation(db as any, { id: 'op-1', kind: 'create_rule', payload });
    const client = fakeFF3((path, init) => {
      if (path.startsWith('/v1/rule-groups/5/rules'))
        return { data: [{ id: '77', attributes: { title: 'Coffee' } }] };
      if (path.startsWith('/v1/rule-groups')) {
        return init?.method === 'POST' ? { data: { id: '5', attributes: {} } } : { data: [] };
      }
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    await replayCreateRule(db as any, client as any, 'op-1', payload);

    expect(
      client.request.mock.calls.filter(
        ([path, init]) => path === '/v1/rules' && init?.method === 'POST',
      ),
    ).toHaveLength(0);
    const [op] = await db.select().from(outboxOperations);
    expect(readPayload<CreateRulePayload>('create_rule', op!.payloadJson).serverId).toBe('77');
  });

  it('reads back a rule whose id is already recorded instead of posting it again', async () => {
    const db = createTestDb();
    const client = fakeFF3((path, init) => {
      if (path === '/v1/rules/77' && !init?.method)
        return { data: { id: '77', attributes: { title: 'Coffee' } } };
      throw new Error(`unexpected ${init?.method ?? 'GET'} ${path}`);
    });

    await replayCreateRule(db as any, client as any, 'op-1', { ...payload, serverId: '77' });

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith('/v1/rules/77');
  });
});
