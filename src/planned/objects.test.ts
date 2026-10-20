import { createTestDb } from '../db/testDb';
import { plannedObjects } from '../db/schema';
import { groupPlanned } from './model';
import { pullPlanned, readPlannedRow, readRuleGroupRow, type PlannedObject } from './objects';
import { plannedItems } from './items';

describe('pullPlanned with rule groups', () => {
  it('caches rule groups as rule_group rows, which the Planned tab model ignores', async () => {
    const db = createTestDb();
    const client = {
      request: jest.fn(async (path: string) => {
        const page = (data: unknown[]) => ({ data: path.includes('page=1') ? data : [] });
        if (path.startsWith('/v1/rule-groups'))
          return page([{ id: '9', attributes: { title: 'Planned', active: true, order: 1 } }]);
        if (path.startsWith('/v1/rules'))
          return page([
            { id: '4', attributes: { title: 'Coffee', rule_group_id: 9, active: true } },
          ]);
        return page([]);
      }),
    };

    await pullPlanned(db as any, client as any);

    const rows = await db.select().from(plannedObjects);
    expect(rows.map((r) => r.key).sort()).toEqual(['rule:4', 'rule_group:9']);
    const group = readRuleGroupRow(rows.find((r) => r.kind === 'rule_group')!);
    expect(group).toMatchObject({ id: '9', name: 'Planned', attributes: { active: true } });

    const objects = rows.map(readPlannedRow).filter((o): o is PlannedObject => o !== null);
    expect(objects.map((o) => o.kind)).toEqual(['rule']);
    expect(groupPlanned(objects).map((g) => g.name)).toEqual(['Coffee']);
    expect(plannedItems(objects, [], '2026-10-12').map((i) => i.key)).not.toContain('Planned');
  });

  it('skips malformed planned object rows', () => {
    const badJson = {
      key: 'bill:99',
      kind: 'bill' as const,
      ff3Id: '99',
      name: 'Bad',
      attributesJson: '{broken json',
      syncedAt: '2026-10-20T12:00:00Z',
    };
    expect(readPlannedRow(badJson)).toBeNull();

    const nonObject = {
      ...badJson,
      attributesJson: '"not an object"',
    };
    expect(readPlannedRow(nonObject)).toBeNull();
  });
});
