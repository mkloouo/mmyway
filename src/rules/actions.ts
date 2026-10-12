// Queues the Rules screen's changes. Like the Planned tab's they go through the outbox, so they
// work offline and reach FF3 in order. A switch also shows at once in the cached rule or group.
import { eq } from 'drizzle-orm';
import { plannedObjects } from '../db/schema';
import { enqueueOperation, type OutboxDb } from '../sync/outbox';
import { cleanAction, cleanTrigger } from '../planned/model';
import {
  plannedKey,
  readPlannedRow,
  readRuleGroupRow,
  storePlanned,
  type RuleAction,
  type RuleTrigger,
} from '../planned/objects';
import { generateId } from '../utils/id';
import type {
  CreateRulePayload,
  TriggerRulePayload,
  ToggleRuleGroupPayload,
  ToggleRulePayload,
} from './replay';

/** Sets the cached object's `active` now; FF3's answer replaces it when the operation lands. */
async function setCachedActive(
  db: OutboxDb,
  kind: 'rule' | 'rule_group',
  id: string,
  active: boolean,
): Promise<void> {
  const [row] = await db
    .select()
    .from(plannedObjects)
    .where(eq(plannedObjects.key, plannedKey(kind, id)));
  const object = row && (kind === 'rule_group' ? readRuleGroupRow(row) : readPlannedRow(row));
  if (!object) return;
  await storePlanned(db, kind, id, { ...object.attributes, active });
}

export async function toggleRule(db: OutboxDb, ruleId: string, active: boolean): Promise<void> {
  await setCachedActive(db, 'rule', ruleId, active);
  const payload: ToggleRulePayload = { ruleId, active };
  await enqueueOperation(db, { id: generateId(), kind: 'toggle_rule', payload });
}

export async function toggleRuleGroup(
  db: OutboxDb,
  groupId: string,
  active: boolean,
): Promise<void> {
  await setCachedActive(db, 'rule_group', groupId, active);
  const payload: ToggleRuleGroupPayload = { ruleGroupId: groupId, active };
  await enqueueOperation(db, { id: generateId(), kind: 'toggle_rule_group', payload });
}

export async function runRule(db: OutboxDb, ruleId: string): Promise<void> {
  const payload: TriggerRulePayload = { ruleId };
  await enqueueOperation(db, { id: generateId(), kind: 'trigger_rule', payload });
}

/** Queues a new rule; returns its client id. It shows once FF3 has it, after the next sync. */
export async function createRule(
  db: OutboxDb,
  form: { title: string; triggers: RuleTrigger[]; actions: RuleAction[] },
): Promise<string> {
  const clientId = `mmyway-${generateId()}`;
  const payload: CreateRulePayload = {
    clientId,
    title: form.title,
    triggers: form.triggers.map(cleanTrigger),
    actions: form.actions.map(cleanAction),
  };
  await enqueueOperation(db, { id: generateId(), kind: 'create_rule', payload });
  return clientId;
}
