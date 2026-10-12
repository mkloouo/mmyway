// Sends the Rules screen's queued changes to FF3: a rule or rule group switched on or off, a rule
// run now, and a rule made from a form. Each answer from FF3 is stored in the cache at once; a rule
// or group that is gone in FF3 is removed from it instead.
import { eq } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import { FF3RequestError } from '../api/ff3/client';
import { fetchAllPages } from '../api/ff3/paginate';
import { outboxOperations } from '../db/schema';
import { ensureRuleGroup } from '../planned/replay';
import {
  plannedPath,
  storePlanned,
  type RuleAction,
  type RuleAttributes,
  type RuleTrigger,
} from '../planned/objects';
import type { OutboxDb } from '../sync/outbox';
import { writePayload } from '../sync/payloadJson';
import { localDay } from '../utils/day';

export interface ToggleRulePayload {
  ruleId: string;
  active: boolean;
}

export interface ToggleRuleGroupPayload {
  ruleGroupId: string;
  active: boolean;
}

export interface TriggerRulePayload {
  ruleId: string;
}

export interface CreateRulePayload {
  /** The temporary mmyway-* id until FF3 has answered; the subject the Inbox matches it by. */
  clientId: string;
  title: string;
  triggers: RuleTrigger[];
  actions: RuleAction[];
  /** Recorded as soon as FF3 creates the rule, so a retry finds it instead of creating another. */
  serverId?: string;
}

type Read<T> = { data: { id: string | number; attributes: T } };

const isGone = (err: unknown) => err instanceof FF3RequestError && err.status === 404;

async function setActive(
  db: OutboxDb,
  client: FF3Client,
  kind: 'rule' | 'rule_group',
  id: string,
  active: boolean,
): Promise<void> {
  let answer: Read<Record<string, unknown>>;
  try {
    answer = await client.request<Read<Record<string, unknown>>>(plannedPath(kind, id), {
      method: 'PUT',
      body: JSON.stringify({ active }),
    });
  } catch (err) {
    if (!isGone(err)) throw err;
    await storePlanned(db, kind, id, null);
    return;
  }
  await storePlanned(db, kind, id, answer.data.attributes);
}

export function replayToggleRule(
  db: OutboxDb,
  client: FF3Client,
  payload: ToggleRulePayload,
): Promise<void> {
  return setActive(db, client, 'rule', payload.ruleId, payload.active);
}

export function replayToggleRuleGroup(
  db: OutboxDb,
  client: FF3Client,
  payload: ToggleRuleGroupPayload,
): Promise<void> {
  return setActive(db, client, 'rule_group', payload.ruleGroupId, payload.active);
}

/**
 * Runs a rule over the year up to today, the way FF3's own rule page does. A rule FF3 no longer has
 * is nothing left to run. `today` is for tests; the outbox passes none.
 */
export async function replayTriggerRule(
  client: FF3Client,
  payload: TriggerRulePayload,
  today: Date = new Date(),
): Promise<void> {
  const start = localDay(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()));
  const end = localDay(today);
  try {
    await client.request(
      `${plannedPath('rule', payload.ruleId)}/trigger?start=${start}&end=${end}`,
      { method: 'POST' },
    );
  } catch (err) {
    if (!isGone(err)) throw err;
  }
}

/**
 * Creates the rule in the Planned rule group (the one the Planned tab's rules go into). The id is
 * recorded in the queued payload right after FF3 answers, so a retry that finds it only reads it
 * back. A failure between the create and that record — the answer lost — can still leave a second
 * rule; FF3 rules have no internal reference to guard it by.
 */
export async function replayCreateRule(
  db: OutboxDb,
  client: FF3Client,
  opId: string,
  payload: CreateRulePayload,
): Promise<void> {
  if (payload.serverId) {
    let rule: Read<RuleAttributes>;
    try {
      rule = await client.request<Read<RuleAttributes>>(plannedPath('rule', payload.serverId));
    } catch (err) {
      if (!isGone(err)) throw err;
      await storePlanned(db, 'rule', payload.serverId, null);
      return;
    }
    await storePlanned(db, 'rule', payload.serverId, rule.data.attributes);
    return;
  }

  const groupId = await ensureRuleGroup(client);
  // An earlier attempt may have landed with its answer lost: adopt that rule rather than make a
  // second one. Rules carry no internal reference, so the title in our group is the match.
  const existing = (
    await fetchAllPages<{ id: string | number; attributes: RuleAttributes }>(
      client,
      `/v1/rule-groups/${groupId}/rules`,
    )
  ).find((r) => r.attributes.title === payload.title);
  const created: Read<RuleAttributes> = existing
    ? { data: { id: String(existing.id), attributes: existing.attributes } }
    : await client.request<Read<RuleAttributes>>(plannedPath('rule'), {
        method: 'POST',
        body: JSON.stringify({
          title: payload.title,
          rule_group_id: groupId,
          trigger: 'store-journal',
          active: true,
          strict: true,
          stop_processing: false,
          triggers: payload.triggers,
          actions: payload.actions,
        }),
      });
  const serverId = String(created.data.id);
  await db
    .update(outboxOperations)
    .set({ payloadJson: writePayload({ ...payload, serverId }) })
    .where(eq(outboxOperations.id, opId));
  await storePlanned(db, 'rule', serverId, created.data.attributes);
}
