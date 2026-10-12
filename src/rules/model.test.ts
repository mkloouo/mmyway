import { rulesByGroup } from './model';
import type { PlannedRow } from '../planned/objects';

const row = (
  kind: PlannedRow['kind'],
  id: string,
  attributes: Record<string, unknown>,
): PlannedRow => ({
  key: `${kind}:${id}`,
  kind,
  ff3Id: id,
  name: String(attributes.title ?? ''),
  attributesJson: JSON.stringify(attributes),
  syncedAt: '2026-10-01T00:00:00Z',
});

describe('rulesByGroup', () => {
  it('orders groups and their rules by FF3 order', () => {
    const groups = rulesByGroup([
      row('rule', '1', { title: 'Late', rule_group_id: 10, order: 2, active: true }),
      row('rule_group', '20', { title: 'Second', order: 2, active: true }),
      row('rule', '2', { title: 'Early', rule_group_id: 10, order: 1, active: true }),
      row('rule_group', '10', { title: 'First', order: 1, active: true }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(['First', 'Second']);
    expect(groups[0]!.rules.map((r) => r.title)).toEqual(['Early', 'Late']);
    expect(groups[1]!.rules).toEqual([]);
  });

  it('a rule runs only when its own flag and its group are both on', () => {
    const [group] = rulesByGroup([
      row('rule_group', '10', { title: 'G', active: false }),
      row('rule', '1', { title: 'R', rule_group_id: '10', active: true }),
    ]);
    expect(group!.active).toBe(false);
    expect(group!.rules[0]).toMatchObject({ active: true, effectiveActive: false });
  });

  it('leaves out rules whose group is not cached and ignores bills and recurrences', () => {
    const groups = rulesByGroup([
      row('rule_group', '10', { title: 'G', active: true }),
      row('rule', '1', { title: 'Orphan', rule_group_id: 99, active: true }),
      row('bill', '3', { name: 'Netflix' }),
      row('recurrence', '4', { title: 'Rent' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rules).toEqual([]);
  });

  it('summarises triggers and actions as type and value', () => {
    const [group] = rulesByGroup([
      row('rule_group', '10', { title: 'G', active: true }),
      row('rule', '1', {
        title: 'R',
        rule_group_id: 10,
        active: true,
        triggers: [{ type: 'description_contains', value: 'Coffee', prohibited: false }],
        actions: [{ type: 'set_category', value: null }],
      }),
    ]);
    expect(group!.rules[0]).toMatchObject({
      triggers: [{ type: 'description_contains', value: 'Coffee' }],
      actions: [{ type: 'set_category', value: null }],
    });
  });
});
