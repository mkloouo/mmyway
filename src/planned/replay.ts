// Sends a planned transaction's save or delete (queued from the Planned tab) to FF3: its
// subscription, recurring transaction and rule, in that order — the recurring transaction links
// to the subscription by id, the rule by name. Each object created is recorded in the queued
// payload straight away, so a retry after a failure part-way updates it instead of creating a
// second one. An object whose id was not recorded — the request landed and only the answer was
// lost — is found again by name before anything is created (adoptExisting). The recurring transaction is sent its accounts and category by id: FF3's recurrence
// API ignores names, and a missing account id made it fail after saving half a recurrence.
import { eq } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import { FF3RequestError } from '../api/ff3/client';
import { outboxOperations } from '../db/schema';
import { accountResolver } from '../sync/accountIds';
import { createFF3Service } from '../api/ff3/service';
import type { OutboxDb } from '../sync/outbox';
import { writePayload } from '../sync/payloadJson';
import { billBody, recurrenceBody, ruleBody, scheduleChanged, type PlannedFields } from './model';
import {
  fetchAllOf,
  plannedPath,
  storePlanned,
  type PlannedKind,
  type RecurrenceAttributes,
  type RuleAttributes,
} from './objects';

export interface SavePlannedPayload {
  /** The simple view's group key (normalised name); a new one's own key until FF3 has it. */
  key: string;
  fields: PlannedFields;
  /** The fields as they were when the edit started; null for a new planned transaction. */
  before: PlannedFields | null;
  billId?: string | null;
  ruleId?: string | null;
  recurrenceId?: string | null;
  /** Set once this save replaced the recurring transaction (see replaySavePlanned); not again on a retry. */
  recurrenceReplaced?: boolean;
  /** Recurring transactions being replaced, deleted before the new one is created. */
  replacedRecurrenceIds?: string[];
}

export interface DeletePlannedPayload {
  key: string;
  name: string;
  billId?: string | null;
  ruleId?: string | null;
  recurrenceId?: string | null;
}

export interface TriggerPlannedPayload {
  key: string;
  name: string;
  recurrenceId: string;
  /** YYYY-MM-DD: the occurrence being fired — the next one it was planned for. */
  date: string;
}

/** The rule group new rules go into when the simple view creates them. */
const PLANNED_RULE_GROUP = 'Planned';

type Read<T> = { data: { id: string; attributes: T } };

async function ensureRuleGroup(client: FF3Client): Promise<string> {
  return createFF3Service(client).ruleGroups.ensure(PLANNED_RULE_GROUP);
}

/** The category's FF3 id: from the synced categories, or a new category when FF3 has none by that name. */
async function categoryIdFor(db: OutboxDb, client: FF3Client, name: string): Promise<string> {
  return createFF3Service(client, db).categories.resolve(name);
}

/**
 * The object FF3 already holds under this name, if any. A save that has no recorded id may have
 * landed with only its answer lost; creating again would be refused (a bill or rule with the same
 * name: a 422 on every retry) or accepted (a second recurring transaction, booking twice a period).
 */
async function adoptExisting(
  client: FF3Client,
  kind: PlannedKind,
  name: string,
): Promise<string | null> {
  const wanted = name.trim().toLowerCase();
  const nameOf = (a: Record<string, unknown>) =>
    String((kind === 'bill' ? a.name : a.title) ?? '')
      .trim()
      .toLowerCase();
  const found = (await fetchAllOf(client, kind)).find(
    (o) =>
      nameOf(o.attributes) === wanted &&
      // A rule of the same title in someone's own rule group is theirs, not ours.
      (kind !== 'rule' ||
        o.attributes.rule_group_title === undefined ||
        o.attributes.rule_group_title === PLANNED_RULE_GROUP),
  );
  return found ? String(found.id) : null;
}

async function send<T>(
  client: FF3Client,
  kind: PlannedKind,
  id: string | null | undefined,
  body: Record<string, unknown>,
): Promise<Read<T>> {
  return client.request<Read<T>>(plannedPath(kind, id ?? undefined), {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
}

export async function replaySavePlanned(
  db: OutboxDb,
  client: FF3Client,
  opId: string,
  payload: SavePlannedPayload,
): Promise<void> {
  const p = { ...payload };
  const remember = () =>
    db
      .update(outboxOperations)
      .set({ payloadJson: writePayload(p) })
      .where(eq(outboxOperations.id, opId));
  const f = p.fields;

  // A missing object is created from all the fields; an existing one is sent what changed.
  if (!p.billId) {
    const adopted = await adoptExisting(client, 'bill', f.name);
    if (adopted) {
      p.billId = adopted;
      await remember();
    }
  }
  const bill = await send<Record<string, unknown>>(
    client,
    'bill',
    p.billId,
    billBody(f, p.billId ? p.before : null),
  );
  if (!p.billId) {
    p.billId = String(bill.data.id);
    await remember();
  }
  await storePlanned(db, 'bill', p.billId, bill.data.attributes);

  // FF3's recurrence API only takes ids: a payee typed or picked by name becomes its account's.
  const resolve = accountResolver(client, db);
  const sourceId = f.sourceId ?? (await resolve(f.type, 'source', f.sourceName ?? ''));
  const destinationId =
    f.destinationId ?? (await resolve(f.type, 'destination', f.destinationName ?? ''));
  const categoryId = f.categoryName ? await categoryIdFor(db, client, f.categoryName) : null;

  // FF3's recurrence *update* validates a repetition's moment as a number up to 10, where create
  // takes up to 10 characters: a yearly moment (a date) fails with "must be a number", a monthly
  // one after the 10th with "may not be greater than 10". So a schedule change replaces the
  // recurring transaction instead of updating it: the old one is deleted first (never two booking
  // at once), then a new one is created with the whole schedule. Recorded at each step, so a retry
  // carries on rather than replacing again.
  // A new save (no `before`) has nothing to replace: a retry's recurring transaction is its own.
  if (p.recurrenceId && !p.recurrenceReplaced && p.before && scheduleChanged(p.before, f)) {
    p.replacedRecurrenceIds = [...(p.replacedRecurrenceIds ?? []), p.recurrenceId];
    p.recurrenceId = null;
    p.recurrenceReplaced = true;
    await remember();
  }
  if (p.replacedRecurrenceIds?.length) {
    for (const old of p.replacedRecurrenceIds) {
      await deleteIfPresent(client, 'recurrence', old);
      await storePlanned(db, 'recurrence', old, null);
    }
    p.replacedRecurrenceIds = [];
    await remember();
  }

  // Found by title: an earlier attempt of this save made it, with this very schedule.
  let adoptedRecurrence = false;
  if (!p.recurrenceId) {
    const adopted = await adoptExisting(client, 'recurrence', f.name);
    if (adopted) {
      p.recurrenceId = adopted;
      adoptedRecurrence = true;
      await remember();
    }
  }
  let transactionId: string | null = null;
  let repetitionId: string | null = null;
  if (p.recurrenceId) {
    const current = await client.request<Read<RecurrenceAttributes>>(
      plannedPath('recurrence', p.recurrenceId),
    );
    transactionId = current.data.attributes.transactions?.[0]?.id ?? null;
    repetitionId = current.data.attributes.repetitions?.[0]?.id ?? null;
  }
  // An existing one is sent what changed; after a replacement, or when found by title, it already
  // has this schedule (as does a retry of a new save's own).
  const recurrenceBefore = p.recurrenceId
    ? p.recurrenceReplaced || adoptedRecurrence || !p.before
      ? f
      : p.before
    : null;
  const recurrence = await send<Record<string, unknown>>(
    client,
    'recurrence',
    p.recurrenceId,
    recurrenceBody({ ...f, sourceId, destinationId }, recurrenceBefore, {
      billId: p.billId,
      transactionId,
      repetitionId,
      categoryId,
    }),
  );
  if (!p.recurrenceId) {
    p.recurrenceId = String(recurrence.data.id);
    await remember();
  }
  await storePlanned(db, 'recurrence', p.recurrenceId, recurrence.data.attributes);

  if (!p.ruleId) {
    const adopted = await adoptExisting(client, 'rule', f.name);
    if (adopted) {
      p.ruleId = adopted;
      await remember();
    }
  }
  let body: Record<string, unknown>;
  if (p.ruleId) {
    // Read now, not when the edit was queued: the rule's own triggers may have changed in FF3.
    const current = await client.request<Read<RuleAttributes>>(plannedPath('rule', p.ruleId));
    body = ruleBody(f, current.data.attributes, p.before?.name ?? null, null);
  } else {
    body = ruleBody(f, null, null, await ensureRuleGroup(client));
  }
  const rule = await send<Record<string, unknown>>(client, 'rule', p.ruleId, body);
  if (!p.ruleId) {
    p.ruleId = String(rule.data.id);
    await remember();
  }
  await storePlanned(db, 'rule', p.ruleId, rule.data.attributes);
}

export async function replayDeletePlanned(
  db: OutboxDb,
  client: FF3Client,
  payload: DeletePlannedPayload,
): Promise<void> {
  for (const [kind, id] of [
    ['rule', payload.ruleId],
    ['recurrence', payload.recurrenceId],
    ['bill', payload.billId],
  ] as const) {
    if (!id) continue;
    await deleteIfPresent(client, kind, id);
    await storePlanned(db, kind, id, null);
  }
}

/**
 * Books the next occurrence of a recurring transaction now, the way FF3's own Recurring page's
 * trigger does: `POST /v1/recurrences/{id}/trigger?date=…` runs the recurring job for that date
 * alone. FF3 doesn't force it, so an occurrence it has already booked isn't booked twice, and a
 * recurrence that fires nothing for that date simply creates nothing. The booked transaction
 * reaches the Inbox as a review card on the next sync (src/sync/recurringReview.ts), like one the
 * nightly cron booked. A recurrence deleted in the meantime is nothing left to fire.
 */
export async function replayTriggerPlanned(
  client: FF3Client,
  payload: TriggerPlannedPayload,
): Promise<void> {
  try {
    await client.request(
      `${plannedPath('recurrence', payload.recurrenceId)}/trigger?date=${encodeURIComponent(payload.date)}`,
      { method: 'POST' },
    );
  } catch (err) {
    if (!(err instanceof FF3RequestError && err.status === 404)) throw err;
  }
}

async function deleteIfPresent(client: FF3Client, kind: PlannedKind, id: string): Promise<void> {
  try {
    await client.request(plannedPath(kind, id), { method: 'DELETE' });
  } catch (err) {
    // Already gone (deleted in FF3's web UI, or by an earlier attempt): that's the goal.
    if (!(err instanceof FF3RequestError && err.status === 404)) throw err;
  }
}
