import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { outboxOperations, plannedObjects } from '../db/schema';
import { readPayload } from '../sync/payloadJson';
import { plannedKey } from '../planned/objects';
import { createRule, runRule, toggleRule, toggleRuleGroup } from './actions';

async function insertCached(
  db: ReturnType<typeof createTestDb>,
  kind: 'rule' | 'rule_group',
  id: string,
  attributes: Record<string, unknown>,
) {
  await db.insert(plannedObjects).values({
    key: plannedKey(kind, id),
    kind,
    ff3Id: id,
    name: String(attributes.title),
    attributesJson: JSON.stringify(attributes),
    syncedAt: '2026-10-01T00:00:00Z',
  });
}

async function cachedActive(db: ReturnType<typeof createTestDb>, key: string) {
  const [row] = await db.select().from(plannedObjects).where(eq(plannedObjects.key, key));
  return JSON.parse(row!.attributesJson).active;
}

describe('rule actions', () => {
  it('toggleRule queues the switch and shows it in the cached rule at once', async () => {
    const db = createTestDb();
    await insertCached(db, 'rule', '4', { title: 'Coffee', active: true });

    await toggleRule(db as any, '4', false);

    const [op] = await db.select().from(outboxOperations);
    expect(op!.kind).toBe('toggle_rule');
    expect(readPayload('toggle_rule', op!.payloadJson)).toEqual({ ruleId: '4', active: false });
    expect(await cachedActive(db, 'rule:4')).toBe(false);
  });

  it('toggleRuleGroup queues the switch and updates the cached group', async () => {
    const db = createTestDb();
    await insertCached(db, 'rule_group', '9', { title: 'Planned', active: true });

    await toggleRuleGroup(db as any, '9', false);

    const [op] = await db.select().from(outboxOperations);
    expect(op!.kind).toBe('toggle_rule_group');
    expect(readPayload('toggle_rule_group', op!.payloadJson)).toEqual({
      ruleGroupId: '9',
      active: false,
    });
    expect(await cachedActive(db, 'rule_group:9')).toBe(false);
  });

  it('runRule queues a trigger', async () => {
    const db = createTestDb();
    await runRule(db as any, '4');
    const [op] = await db.select().from(outboxOperations);
    expect(op!.kind).toBe('trigger_rule');
    expect(readPayload('trigger_rule', op!.payloadJson)).toEqual({ ruleId: '4' });
  });

  it('createRule queues a create with cleaned triggers and actions', async () => {
    const db = createTestDb();
    const clientId = await createRule(db as any, {
      title: 'Coffee',
      triggers: [{ type: 'description_contains', value: 'Coffee' }],
      actions: [{ type: 'set_category', value: 'Food' }],
    });
    const [op] = await db.select().from(outboxOperations);
    expect(op!.kind).toBe('create_rule');
    expect(readPayload('create_rule', op!.payloadJson)).toEqual({
      clientId,
      title: 'Coffee',
      triggers: [
        { type: 'description_contains', value: 'Coffee', active: true, stop_processing: false },
      ],
      actions: [{ type: 'set_category', value: 'Food', active: true, stop_processing: false }],
    });
  });
});
