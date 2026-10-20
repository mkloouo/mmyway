// The Planned tab's simple view: one "planned transaction" is the subscription, rule and recurring
// transaction that share a name, edited together. This file turns the three FF3 objects into one
// set of fields and back into what FF3 takes for each. Pure, no db.
import { normkey } from '../lookup/normkey';
import { localDay } from '../utils/day';
import { readMarkers, stripMarkers } from './notes';
import { REPEAT_FOREVER_UNTIL } from './plannedBodies';
import {
  defaultRepetition,
  repetitionFromFF3,
  type EndCondition,
  type Repetition,
} from './repetition';
import type { PlannedObject, RuleAttributes } from './objects';

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

/**
 * A blank PlannedFields with defaults (withdrawal, repeat monthly from today, forever).
 * Shared by New Planned Payment and Planned Item editor.
 */
export function blankPlanned(today: string = localDay()): PlannedFields {
  return {
    name: '',
    type: 'withdrawal',
    sourceId: null,
    sourceName: null,
    destinationId: null,
    destinationName: null,
    amount: '0',
    currencyCode: '',
    notes: null,
    repeats: true,
    repetitions: [defaultRepetition(today)],
    end: { kind: 'forever' },
    date: today,
    time: null,
    skipDays: [],
    categoryName: null,
    tags: [],
  };
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

export {
  scheduleChanged,
  samePlannedFields,
  normalizeFields,
  byDate,
  plannedProblems,
} from './plannedValidation';

export {
  BILL_FOREVER_END,
  REPEAT_FOREVER_UNTIL,
  billBody,
  endBody,
  recurrenceBody,
  cleanTrigger,
  cleanAction,
  ruleBody,
} from './plannedBodies';
