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
import {
  billBody,
  normalizeFields,
  recurrenceBody,
  ruleBody,
  scheduleChanged,
  type PlannedFields,
} from './model';
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
  const p = {
    ...payload,
    fields: normalizeFields(payload.fields),
    before: payload.before ? normalizeFields(payload.before) : null,
  };
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

  // A schedule change is a plain PUT. FF3 6.7.0 — the app's floor (src/api/ff3/auth.ts) — validates
  // a repetition's `moment` as a string on update, as create always did; older releases read it as
  // a number, which no yearly moment (a date) and no monthly one past the 10th could satisfy, so
  // the app used to delete the recurring transaction and create a replacement for every schedule
  // edit, losing its id and with it the `mmyway-` markers kept in its notes.

  // Found by title: an earlier attempt of this save made it.
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
  let storedRepetitions = 0;
  let storedNotes: string | null = null;
  if (p.recurrenceId) {
    const current = await client.request<Read<RecurrenceAttributes>>(
      plannedPath('recurrence', p.recurrenceId),
    );
    transactionId = current.data.attributes.transactions?.[0]?.id ?? null;
    storedRepetitions = current.data.attributes.repetitions?.length ?? 0;
    storedNotes = current.data.attributes.notes ?? null;
  }
  // An existing one is sent what changed; one found by title already has this schedule (as does a
  // retry of a new save's own).
  const recurrenceBefore = p.recurrenceId ? (adoptedRecurrence || !p.before ? f : p.before) : null;
  const body = (overrideRepetitions?: readonly PlannedFields['repetitions'][number][]) =>
    recurrenceBody({ ...f, sourceId, destinationId }, recurrenceBefore, {
      billId: p.billId,
      transactionId,
      categoryId,
      existingNotes: storedNotes,
      ...(overrideRepetitions ? { overrideRepetitions } : {}),
    });

  /**
   * `updateRepetitions` only *matches* submitted repetitions to stored ones when the stored count
   * is greater than one and the submitted count equals it — and `matchRepetition` queries on every
   * field, so a changed `type`, `moment`, `skip` or `weekend` matches nothing and FF3 throws
   * "Cannot match recurring repetition to existing repetition." Sending one repetition first makes
   * both counts differ, so each PUT takes the delete-and-recreate branch instead. A failure between
   * the two leaves a valid single-repetition recurrence, and the replay converges on the next
   * attempt because the final body is idempotent.
   */
  const needsTwoStep =
    !!p.recurrenceId &&
    storedRepetitions > 1 &&
    f.repetitions.length === storedRepetitions &&
    scheduleChanged(recurrenceBefore, f);
  if (needsTwoStep && f.repetitions[0])
    await send<Record<string, unknown>>(
      client,
      'recurrence',
      p.recurrenceId,
      body([f.repetitions[0]]),
    );

  const recurrence = await send<Record<string, unknown>>(
    client,
    'recurrence',
    p.recurrenceId,
    needsTwoStep ? body(f.repetitions) : body(),
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
  let rules: Record<string, unknown>;
  if (p.ruleId) {
    // Read now, not when the edit was queued: the rule's own triggers may have changed in FF3.
    const current = await client.request<Read<RuleAttributes>>(plannedPath('rule', p.ruleId));
    rules = ruleBody(f, current.data.attributes, p.before?.name ?? null, null);
  } else {
    rules = ruleBody(f, null, null, await ensureRuleGroup(client));
  }
  const rule = await send<Record<string, unknown>>(client, 'rule', p.ruleId, rules);
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
 *
 * The date in the query says *which occurrence* to fire, not what the transaction is dated:
 * `TriggerController` calls `markGroupsAsNow()`, so the journal FF3 creates is dated **today**
 * whatever occurrence fired it, and `latest_date` is put back afterwards.
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
