// The Rules screen's data: FF3's rule groups and the rules in them, from planned_objects, in the
// order Firefly III runs them. Pure, no db.
import {
  readPlannedRow,
  readRuleGroupRow,
  type PlannedObject,
  type PlannedRow,
  type RuleGroupObject,
} from '../planned/objects';

export interface RuleSummary {
  id: string;
  title: string;
  /** The rule's own flag in FF3. */
  active: boolean;
  /** Whether it runs at all: its own flag and its group's. */
  effectiveActive: boolean;
  order: number;
  triggers: { type: string; value: string }[];
  actions: { type: string; value: string | null }[];
}

export interface RuleGroupSummary {
  id: string;
  title: string;
  active: boolean;
  order: number;
  rules: RuleSummary[];
}

const orderOf = (attributes: Record<string, unknown>): number =>
  typeof attributes.order === 'number' ? attributes.order : 0;

const byOrder = (a: { order: number; title: string }, b: { order: number; title: string }) =>
  a.order - b.order || a.title.localeCompare(b.title);

/**
 * Rule groups in FF3's `order`, each with its rules in theirs. A rule whose group isn't cached is
 * left out (groups and rules are pulled together, so only a group deleted in FF3 gets here).
 */
export function rulesByGroup(rows: readonly PlannedRow[]): RuleGroupSummary[] {
  const groups = rows.map(readRuleGroupRow).filter((g): g is RuleGroupObject => g !== null);
  const rules = rows
    .map(readPlannedRow)
    .filter((o): o is Extract<PlannedObject, { kind: 'rule' }> => o?.kind === 'rule');

  return groups
    .map((group) => {
      const active = group.attributes.active !== false;
      const summaries: RuleSummary[] = rules
        .filter((rule) => String(rule.attributes.rule_group_id ?? '') === group.id)
        .map((rule) => {
          const own = rule.attributes.active !== false;
          return {
            id: rule.id,
            title: rule.attributes.title,
            active: own,
            effectiveActive: own && active,
            order: orderOf(rule.attributes),
            triggers: (rule.attributes.triggers ?? []).map((t) => ({
              type: t.type,
              value: t.value,
            })),
            actions: (rule.attributes.actions ?? []).map((a) => ({ type: a.type, value: a.value })),
          };
        })
        .sort(byOrder);
      return {
        id: group.id,
        title: group.name,
        active,
        order: orderOf(group.attributes),
        rules: summaries,
      };
    })
    .sort(byOrder);
}
