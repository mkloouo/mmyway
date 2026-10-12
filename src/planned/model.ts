// The Planned tab's simple view: one "planned transaction" is the subscription, rule and recurring
// transaction that share a name, edited together. This file turns the three FF3 objects into one
// set of fields and back into what FF3 takes for each. Pure, no db.
import { normkey } from '../lookup/normkey';
import { readMarkers, stripMarkers, writeMarkers } from './notes';
import {
  billSchedule,
  defaultRepetition,
  momentFor,
  repetitionFromFF3,
  repetitionProblem,
  repetitionToFF3,
  sameEnd,
  sameRepetitions,
  type EndCondition,
  type Repetition,
  type RepetitionType,
} from './repetition';
import type { PlannedObject, RuleAction, RuleAttributes, RuleTrigger } from './objects';

export interface PlannedFields {
  name: string;
  type: 'withdrawal' | 'deposit' | 'transfer';
  sourceId: string | null;
  sourceName: string | null;
  destinationId: string | null;
  destinationName: string | null;
  /** Exact in this view: the real amount is corrected when the recurring transaction is reviewed. */
  amount: string;
  currencyCode: string;
  notes: string | null;
  repeats: boolean;
  /**
   * The whole schedule, as FF3 holds it. A recurrence may repeat on several patterns at once
   * ("the 1st and the 15th"); sending only the first destroyed the rest, because FF3 deletes and
   * recreates the array whenever the submitted count differs from the stored one.
   */
  repetitions: Repetition[];
  end: EndCondition;
  /** YYYY-MM-DD: the next time it is planned. */
  date: string;
  /** HH:MM it is planned at, or null for any time (a marker in the recurrence's notes, ./notes.ts). */
  time: string | null;
  /** Occurrences the user cancelled one by one (the `mmyway-skip` marker, ./notes.ts). */
  skipDays: string[];
  categoryName: string | null;
  tags: string[];
}

export interface PlannedGroup {
  key: string;
  name: string;
  bill?: Extract<PlannedObject, { kind: 'bill' }>;
  rule?: Extract<PlannedObject, { kind: 'rule' }>;
  recurrence?: Extract<PlannedObject, { kind: 'recurrence' }>;
}

const groupKey = (name: string) => normkey(name);

/** Subscriptions, rules and recurring transactions matched by name (case and accents aside). */
export function groupPlanned(objects: readonly PlannedObject[]): PlannedGroup[] {
  const groups = new Map<string, PlannedGroup>();
  for (const object of objects) {
    const key = groupKey(object.name);
    if (!key) continue;
    const group = groups.get(key) ?? { key, name: object.name };
    // The first of each kind wins; a second one with the same name is only in the detailed view.
    if (object.kind === 'bill' && !group.bill) group.bill = object;
    if (object.kind === 'rule' && !group.rule) group.rule = object;
    if (object.kind === 'recurrence' && !group.recurrence) group.recurrence = object;
    if (object.kind === 'recurrence' || (object.kind === 'bill' && !group.recurrence))
      group.name = object.name;
    groups.set(key, group);
  }
  return [...groups.values()];
}

const dateOnly = (value: string | null | undefined): string | null =>
  value ? value.slice(0, 10) : null;
const text = (value: unknown): string | null =>
  value == null || value === '' ? null : String(value);

function actionValue(rule: RuleAttributes | undefined, type: string): string | null {
  return text(rule?.actions?.find((a) => a.type === type)?.value);
}

/** The date "forever" is expressed as on a recurrence: FF3's API has no such thing. */
const REPEAT_FOREVER_UNTIL = '2099-12-31';
/**
 * The far-future end date a repeating subscription is given. A bill's `end_date` has no `nullable`
 * on update and is capped by `before:2038-01-17` (`Bill/UpdateRequest.php`), so an end date left
 * behind by a one-off cannot be cleared — it is pushed out of the way instead. (`2099-12-31`, which
 * `repeat_until` takes, would be refused here.)
 */
export const BILL_FOREVER_END = '2038-01-16';

/**
 * How the recurrence ends. FF3 holds exactly one of the two keys, and a one-off is
 * `nr_of_repetitions: 1` — which is also what `repeats: false` means.
 */
function endOf(
  rec: { repeat_until?: string | null; nr_of_repetitions?: number | null } | undefined,
): EndCondition {
  const count = rec?.nr_of_repetitions;
  if (count != null && count >= 1) return { kind: 'times', count };
  const until = dateOnly(rec?.repeat_until);
  if (until && until < REPEAT_FOREVER_UNTIL) return { kind: 'until', date: until };
  return { kind: 'forever' };
}

/** The fields the simple view shows and edits, read from whichever of the three exist. */
export function fieldsOf(group: PlannedGroup, today: string): PlannedFields {
  const bill = group.bill?.attributes;
  const rule = group.rule?.attributes;
  const rec = group.recurrence?.attributes;
  const tx = rec?.transactions?.[0];
  const reps = rec?.repetitions ?? [];
  const type = rec?.type === 'deposit' || rec?.type === 'transfer' ? rec.type : 'withdrawal';
  const repeats = rec ? rec.nr_of_repetitions !== 1 : bill ? !bill.end_date : true;
  const date =
    dateOnly(reps[0]?.occurrences?.[0]) ??
    dateOnly(bill?.next_expected_match) ??
    dateOnly(rec?.first_date) ??
    dateOnly(bill?.date) ??
    today;
  // The recurring transaction's repetitions *are* the schedule. The subscription's repeat_freq is
  // derived from them on write (billSchedule) and never read back as one: two objects holding the
  // schedule, disagreeing, and whichever was read last winning is what lost the user's choice on
  // every round trip. A planned transaction with no recurrence yet is the only fallback.
  const repetitions = reps.length ? reps.map(repetitionFromFF3) : [defaultRepetition(date)];
  const markers = readMarkers(rec?.notes);
  const ruleTags = (rule?.actions ?? [])
    .filter((a) => a.type === 'add_tag')
    .map((a) => a.value)
    .filter((v): v is string => !!v);
  return {
    name: group.name,
    type,
    sourceId: text(tx?.source_id),
    sourceName:
      text(tx?.source_name) ??
      (type === 'deposit' ? actionValue(rule, 'set_source_account') : null),
    destinationId: text(tx?.destination_id),
    destinationName:
      text(tx?.destination_name) ??
      (type === 'withdrawal' ? actionValue(rule, 'set_destination_account') : null),
    amount: text(tx?.amount) ?? text(bill?.amount_max) ?? '0',
    currencyCode: text(tx?.currency_code) ?? text(bill?.currency_code) ?? '',
    // The user's note is the bill's, because a bill update keeps newlines where a recurrence update
    // strips them. A recurrence without a bill (made in the web UI) keeps its own, markers aside.
    notes: bill ? text(bill.notes) : stripMarkers(text(rec?.notes)),
    time: markers.time,
    skipDays: markers.skip,
    repeats,
    repetitions,
    end: endOf(rec),
    date,
    categoryName: text(tx?.category_name) ?? actionValue(rule, 'set_category'),
    tags: tx?.tags?.length ? tx.tags : ruleTags,
  };
}

/** Whether a change touches the schedule; unchanged, the objects' own dates are left alone. */
export function scheduleChanged(before: PlannedFields | null, after: PlannedFields): boolean {
  return (
    !before ||
    before.date !== after.date ||
    before.repeats !== after.repeats ||
    !sameEnd(before.end, after.end) ||
    !sameRepetitions(before.repetitions, after.repetitions)
  );
}

/** Whether `after` says what `before` does: Save on a planned transaction left as it was queues nothing. */
export function samePlannedFields(before: PlannedFields, after: PlannedFields): boolean {
  return (Object.keys(before) as (keyof PlannedFields)[]).every((key) => {
    const [a, b] = [before[key], after[key]];
    if (key === 'repetitions') return sameRepetitions(a as Repetition[], b as Repetition[]);
    if (key === 'end') return sameEnd(a as EndCondition, b as EndCondition);
    if (Array.isArray(a) && Array.isArray(b)) return a.join('\n') === b.join('\n');
    // A notes field typed into and emptied again is '' where FF3's was null.
    if (key === 'notes') return (a || null) === (b || null);
    return a === b;
  });
}

/**
 * A `save_planned` queued by a build that kept five presets and `repetitions[0]`: it sits in the
 * outbox across an app update, so it is read back rather than failed. One pure function instead of
 * a payload version bump and a v1→v2 converter, which is strictly more code for the same result.
 */
export function normalizeFields(fields: PlannedFields): PlannedFields {
  if (Array.isArray(fields.repetitions) && fields.repetitions.length > 0) return fields;
  const legacy = fields as unknown as { frequency?: string; every?: number };
  const every = Math.max(1, legacy.every ?? 1);
  // The five presets, back to what they meant: quarterly and half-year were monthly + skip.
  const scaled: Record<string, { type: RepetitionType; every: number }> = {
    daily: { type: 'daily', every },
    weekly: { type: 'weekly', every },
    monthly: { type: 'monthly', every },
    quarterly: { type: 'monthly', every: every * 3 },
    'half-year': { type: 'monthly', every: every * 6 },
    yearly: { type: 'yearly', every },
  };
  const { type, every: n } = scaled[legacy.frequency ?? 'monthly'] ?? scaled.monthly!;
  return {
    ...fields,
    repetitions: [{ type, moment: momentFor(type, fields.date), skip: n - 1, weekend: 1 }],
    end: fields.end ?? (fields.repeats ? { kind: 'forever' } : { kind: 'times', count: 1 }),
    skipDays: fields.skipDays ?? [],
  };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** FF3 bill body. A one-off is a bill that ends the day after it's due. */
export function billBody(f: PlannedFields, before: PlannedFields | null): Record<string, unknown> {
  return {
    name: f.name,
    amount_min: f.amount,
    amount_max: f.amount,
    currency_code: f.currencyCode,
    // Null clears them, which FF3 has taken on a bill update since 6.7.0 (`['nullable', 'min:1',
    // 'max:32768']`) — the app's floor, so the note the user emptied really is emptied.
    notes: f.notes || null,
    active: true,
    ...(scheduleChanged(before, f)
      ? {
          date: f.date,
          // Derived from the recurrence's repetitions, and lossy on purpose: see billSchedule.
          ...(f.repeats ? billSchedule(f.repetitions) : { repeat_freq: 'yearly', skip: 0 }),
          // A one-off ends the day after it's due. A repeating one is pushed out to the sentinel
          // rather than left as it was: FF3 refuses a null here, so this is how an end date left
          // behind by a one-off switched back to repeating gets cleared.
          end_date: f.repeats ? BILL_FOREVER_END : addDays(f.date, 1),
        }
      : {}),
  };
}

/**
 * FF3 recurrence body. `transactionId` is the existing recurrence transaction, updated in place;
 * the amount is sent in the planned currency even when the account keeps another (Spotify's
 * 7.99 USD from a PLN account) — the exact PLN amount is set when the transaction is reviewed.
 * FF3's recurrence API reads accounts and the category by id only (it drops the names, and a
 * missing account id fails the save half-way), so `f` must carry both account ids.
 *
 * `repetitions` is sent only when the schedule changed, and `overrideRepetitions` is how the
 * intermediate PUT of replay.ts's two-step write sends a single one (see there).
 */
export function recurrenceBody(
  f: PlannedFields & { sourceId: string; destinationId: string },
  before: PlannedFields | null,
  opts: {
    billId?: string | null;
    transactionId?: string | null;
    categoryId?: string | null;
    /** The recurrence's notes as FF3 holds them, so a marker this build doesn't know survives. */
    existingNotes?: string | null;
    overrideRepetitions?: readonly Repetition[];
  },
): Record<string, unknown> {
  const transaction: Record<string, unknown> = {
    ...(opts.transactionId ? { id: opts.transactionId } : {}),
    description: f.name,
    amount: f.amount,
    currency_code: f.currencyCode,
    source_id: f.sourceId,
    destination_id: f.destinationId,
    // Null clears it on an edit.
    category_id: opts.categoryId ?? null,
    ...(f.tags.some((t) => t.trim()) ? { tags: f.tags.filter((t) => t.trim()) } : {}),
    ...(opts.billId ? { bill_id: opts.billId } : {}),
  };
  const repetitions = opts.overrideRepetitions ?? f.repetitions;
  return {
    type: f.type,
    title: f.name,
    // The app's markers only: a recurrence update strips newlines, so the user's note is the
    // subscription's. Sending the key at all is deliberate — an omitted one would leave FF3's
    // stored value, and clearing the last marker has to clear the field.
    notes: writeMarkers({ time: f.time, skip: f.skipDays }, opts.existingNotes),
    active: true,
    apply_rules: true,
    ...(scheduleChanged(before, f) || opts.overrideRepetitions
      ? {
          first_date: f.date,
          ...endBody(f),
          repetitions: repetitions.map(repetitionToFF3),
        }
      : {}),
    transactions: [transaction],
  };
}

/**
 * The end condition. FF3 wants exactly one of the two keys and a key sent as null still counts as
 * sent ("Require either a number of repetitions, or an end date. Not both."), so "forever" is a
 * date far enough away to mean "until changed".
 */
function endBody(f: PlannedFields): Record<string, unknown> {
  if (!f.repeats) return { nr_of_repetitions: 1 };
  if (f.end.kind === 'times') return { nr_of_repetitions: Math.max(2, f.end.count) };
  if (f.end.kind === 'until') return { repeat_until: f.end.date };
  return { repeat_until: REPEAT_FOREVER_UNTIL };
}
/** The rule actions the simple view owns; any other action on the rule is kept as it is. */
const MANAGED_ACTIONS = new Set([
  'link_to_bill',
  'set_category',
  'set_destination_account',
  'set_source_account',
  'add_tag',
]);

function managedActions(f: PlannedFields): RuleAction[] {
  const action = (type: string, value: string): RuleAction => ({
    type,
    value,
    active: true,
    stop_processing: false,
  });
  const out: RuleAction[] = [action('link_to_bill', f.name)];
  if (f.categoryName) out.push(action('set_category', f.categoryName));
  if (f.type === 'withdrawal' && f.destinationName)
    out.push(action('set_destination_account', f.destinationName));
  if (f.type === 'deposit' && f.sourceName) out.push(action('set_source_account', f.sourceName));
  for (const tag of f.tags) out.push(action('add_tag', tag));
  return out;
}

export const cleanTrigger = (t: RuleTrigger): RuleTrigger => ({
  type: t.type,
  value: t.value,
  active: t.active ?? true,
  stop_processing: t.stop_processing ?? false,
  ...(t.prohibited !== undefined ? { prohibited: t.prohibited } : {}),
});
export const cleanAction = (a: RuleAction): RuleAction => ({
  type: a.type,
  value: a.value,
  active: a.active ?? true,
  stop_processing: a.stop_processing ?? false,
});

/**
 * FF3 rule body. A new rule matches descriptions containing the name. An existing rule keeps its
 * own triggers (a bank's text for the subscription), with the old name renamed; of its actions,
 * those the simple view owns are replaced and the rest kept.
 */
export function ruleBody(
  f: PlannedFields,
  existing: RuleAttributes | null,
  oldName: string | null,
  ruleGroupId: string | null,
): Record<string, unknown> {
  if (!existing) {
    return {
      title: f.name,
      rule_group_id: ruleGroupId,
      trigger: 'store-journal',
      active: true,
      strict: true,
      stop_processing: false,
      triggers: [
        { type: 'description_contains', value: f.name, active: true, stop_processing: false },
      ],
      actions: managedActions(f),
    };
  }
  const renamed = (value: string) =>
    oldName && normkey(value) === normkey(oldName) ? f.name : value;
  return {
    title: f.name,
    triggers: (existing.triggers ?? []).map((t) =>
      cleanTrigger({ ...t, value: renamed(String(t.value ?? '')) }),
    ),
    actions: [
      ...(existing.actions ?? []).filter((a) => !MANAGED_ACTIONS.has(a.type)).map(cleanAction),
      ...managedActions(f),
    ],
  };
}

/** Next occurrence first; undated last. */
export function byDate(a: { fields: PlannedFields }, b: { fields: PlannedFields }): number {
  return a.fields.date.localeCompare(b.fields.date) || a.fields.name.localeCompare(b.fields.name);
}

/** The fields every save must have; the rest are optional. */
export function plannedProblems(f: PlannedFields): string[] {
  const problems: string[] = [];
  if (!f.name.trim()) problems.push('name');
  if (/^0*\.?0*$/.test(f.amount)) problems.push('amount');
  if (!f.currencyCode) problems.push('currency');
  // Every type needs both ends: an own account and a payee/payer, or two own accounts.
  if (!f.sourceId && !f.sourceName) problems.push('source');
  if (!f.destinationId && !f.destinationName) problems.push('destination');
  if (f.repeats) {
    if (f.repetitions.length === 0 || f.repetitions.some(repetitionProblem))
      problems.push('schedule');
    if (f.end.kind === 'until' && f.end.date < f.date) problems.push('endDate');
  }
  return problems;
}
