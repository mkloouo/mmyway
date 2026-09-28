// Sends a planned transaction's save or delete (queued from the Planned tab) to FF3: its
// subscription, recurring transaction and rule, in that order — the recurring transaction links
// to the subscription by id, the rule by name. Each object created is recorded in the queued
// payload straight away, so a retry after a failure part-way updates it instead of creating a
// second one.
import { eq } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import { FF3RequestError } from '../api/ff3/client';
import { outboxOperations } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';
import { writePayload } from '../sync/payloadJson';
import { billBody, recurrenceBody, ruleBody, type PlannedFields } from './model';
import { plannedPath, storePlanned, type PlannedKind, type RecurrenceAttributes, type RuleAttributes } from './objects';

export interface SavePlannedPayload {
  /** The simple view's group key (normalised name); a new one's own key until FF3 has it. */
  key: string;
  fields: PlannedFields;
  /** The fields as they were when the edit started; null for a new planned transaction. */
  before: PlannedFields | null;
  billId?: string | null;
  ruleId?: string | null;
  recurrenceId?: string | null;
}

export interface DeletePlannedPayload {
  key: string;
  name: string;
  billId?: string | null;
  ruleId?: string | null;
  recurrenceId?: string | null;
}

/** The rule group new rules go into when the simple view creates them. */
export const PLANNED_RULE_GROUP = 'Planned';

type Read<T> = { data: { id: string; attributes: T } };

async function ensureRuleGroup(client: FF3Client): Promise<string> {
  for (let page = 1; ; page++) {
    const response = await client.request<{ data: { id: string; attributes: { title: string } }[] }>(`/v1/rule-groups?limit=100&page=${page}`);
    const found = response.data.find((g) => g.attributes.title === PLANNED_RULE_GROUP);
    if (found) return String(found.id);
    if (response.data.length < 100) break;
  }
  const created = await client.request<Read<{ title: string }>>('/v1/rule-groups', {
    method: 'POST', body: JSON.stringify({ title: PLANNED_RULE_GROUP, active: true }),
  });
  return String(created.data.id);
}

async function send<T>(client: FF3Client, kind: PlannedKind, id: string | null | undefined, body: Record<string, unknown>): Promise<Read<T>> {
  return client.request<Read<T>>(plannedPath(kind, id ?? undefined), { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
}

export async function replaySavePlanned(db: OutboxDb, client: FF3Client, opId: string, payload: SavePlannedPayload): Promise<void> {
  const p = { ...payload };
  const remember = () => db.update(outboxOperations).set({ payloadJson: writePayload(p) }).where(eq(outboxOperations.id, opId));
  const f = p.fields;

  // A missing object is created from all the fields; an existing one is sent what changed.
  const bill = await send<Record<string, unknown>>(client, 'bill', p.billId, billBody(f, p.billId ? p.before : null));
  if (!p.billId) { p.billId = String(bill.data.id); await remember(); }
  await storePlanned(db, 'bill', p.billId, bill.data.attributes);

  let transactionId: string | null = null;
  let repetitionId: string | null = null;
  if (p.recurrenceId) {
    const current = await client.request<Read<RecurrenceAttributes>>(plannedPath('recurrence', p.recurrenceId));
    transactionId = current.data.attributes.transactions?.[0]?.id ?? null;
    repetitionId = current.data.attributes.repetitions?.[0]?.id ?? null;
  }
  const recurrence = await send<Record<string, unknown>>(client, 'recurrence', p.recurrenceId,
    recurrenceBody(f, p.recurrenceId ? p.before : null, { billId: p.billId, transactionId, repetitionId }));
  if (!p.recurrenceId) { p.recurrenceId = String(recurrence.data.id); await remember(); }
  await storePlanned(db, 'recurrence', p.recurrenceId, recurrence.data.attributes);

  let body: Record<string, unknown>;
  if (p.ruleId) {
    // Read now, not when the edit was queued: the rule's own triggers may have changed in FF3.
    const current = await client.request<Read<RuleAttributes>>(plannedPath('rule', p.ruleId));
    body = ruleBody(f, current.data.attributes, p.before?.name ?? null, null);
  } else {
    body = ruleBody(f, null, null, await ensureRuleGroup(client));
  }
  const rule = await send<Record<string, unknown>>(client, 'rule', p.ruleId, body);
  if (!p.ruleId) { p.ruleId = String(rule.data.id); await remember(); }
  await storePlanned(db, 'rule', p.ruleId, rule.data.attributes);
}

export async function replayDeletePlanned(db: OutboxDb, client: FF3Client, payload: DeletePlannedPayload): Promise<void> {
  for (const [kind, id] of [['rule', payload.ruleId], ['recurrence', payload.recurrenceId], ['bill', payload.billId]] as const) {
    if (!id) continue;
    try {
      await client.request(plannedPath(kind, id), { method: 'DELETE' });
    } catch (err) {
      // Already gone (deleted in FF3's web UI, or by an earlier attempt): that's the goal.
      if (!(err instanceof FF3RequestError && err.status === 404)) throw err;
    }
    await storePlanned(db, kind, id, null);
  }
}
