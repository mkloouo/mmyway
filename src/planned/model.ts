// The Planned tab's simple view: one "planned transaction" is the subscription, rule and recurring
// transaction that share a name, edited together. This file turns the three FF3 objects into one
// set of fields and back into what FF3 takes for each. Pure, no db.
import { normkey } from '../lookup/normkey';
import { readPlannedTime, stripPlannedTime, withPlannedTime } from './plannedTime';
import type {
  BillAttributes, PlannedObject, RecurrenceRepetition, RuleAction, RuleAttributes, RuleTrigger,
} from './objects';

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'half-year' | 'yearly';
export const FREQUENCIES: readonly Frequency[] = ['weekly', 'monthly', 'quarterly', 'half-year', 'yearly'];

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
  frequency: Frequency;
  /** Every how many periods: 1 is every week/month/…, FF3's `skip` is this minus one. */
  every: number;
  /** YYYY-MM-DD: the next time it is planned. */
  date: string;
  /** HH:MM it is planned at, or null for any time (kept in the recurrence's notes, src/planned/plannedTime.ts). */
  time: string | null;
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

export const groupKey = (name: string) => normkey(name);

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
    if (object.kind === 'recurrence' || (object.kind === 'bill' && !group.recurrence)) group.name = object.name;
    groups.set(key, group);
  }
  return [...groups.values()];
}

const dateOnly = (value: string | null | undefined): string | null => (value ? value.slice(0, 10) : null);
const text = (value: unknown): string | null => (value == null || value === '' ? null : String(value));

function actionValue(rule: RuleAttributes | undefined, type: string): string | null {
  return text(rule?.actions?.find((a) => a.type === type)?.value);
}

function frequencyFromBill(bill: BillAttributes): { frequency: Frequency; every: number } {
  const freq = FREQUENCIES.find((f) => f === bill.repeat_freq) ?? 'monthly';
  return { frequency: freq, every: (bill.skip ?? 0) + 1 };
}

function frequencyFromRepetition(rep: RecurrenceRepetition): { frequency: Frequency; every: number } {
  const every = (rep.skip ?? 0) + 1;
  if (rep.type === 'weekly') return { frequency: 'weekly', every };
  if (rep.type === 'yearly') return { frequency: 'yearly', every };
  return { frequency: 'monthly', every };
}

/** The fields the simple view shows and edits, read from whichever of the three exist. */
export function fieldsOf(group: PlannedGroup, today: string): PlannedFields {
  const bill = group.bill?.attributes;
  const rule = group.rule?.attributes;
  const rec = group.recurrence?.attributes;
  const tx = rec?.transactions?.[0];
  const rep = rec?.repetitions?.[0];
  const type = rec?.type === 'deposit' || rec?.type === 'transfer' ? rec.type : 'withdrawal';
  const repeats = rec ? rec.nr_of_repetitions !== 1 : bill ? !bill.end_date : true;
  // A one-off's bill says yearly only because FF3 bills must repeat (billBody): its repetition is
  // the better guess at what "Repeats" should start from if it is switched on.
  const schedule = bill && (repeats || !rep) ? frequencyFromBill(bill) : rep ? frequencyFromRepetition(rep) : { frequency: 'monthly' as const, every: 1 };
  const date = dateOnly(rep?.occurrences?.[0]) ?? dateOnly(bill?.next_expected_match) ?? dateOnly(rec?.first_date) ?? dateOnly(bill?.date) ?? today;
  const ruleTags = (rule?.actions ?? []).filter((a) => a.type === 'add_tag').map((a) => a.value).filter((v): v is string => !!v);
  return {
    name: group.name,
    type,
    sourceId: text(tx?.source_id),
    sourceName: text(tx?.source_name) ?? (type === 'deposit' ? actionValue(rule, 'set_source_account') : null),
    destinationId: text(tx?.destination_id),
    destinationName: text(tx?.destination_name) ?? (type === 'withdrawal' ? actionValue(rule, 'set_destination_account') : null),
    amount: text(tx?.amount) ?? text(bill?.amount_max) ?? '0',
    currencyCode: text(tx?.currency_code) ?? text(bill?.currency_code) ?? '',
    notes: stripPlannedTime(text(rec?.notes) ?? text(bill?.notes)),
    time: readPlannedTime(rec?.notes),
    repeats,
    ...schedule,
    date,
    categoryName: text(tx?.category_name) ?? actionValue(rule, 'set_category'),
    tags: tx?.tags?.length ? tx.tags : ruleTags,
  };
}

/** Whether a change touches the schedule; unchanged, the objects' own dates are left alone. */
export function scheduleChanged(before: PlannedFields | null, after: PlannedFields): boolean {
  return !before || before.date !== after.date || before.repeats !== after.repeats
    || before.frequency !== after.frequency || before.every !== after.every;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** FF3 bill body. A one-off is a yearly bill that ends the day after it's due. */
export function billBody(f: PlannedFields, before: PlannedFields | null): Record<string, unknown> {
  return {
    name: f.name,
    amount_min: f.amount,
    amount_max: f.amount,
    currency_code: f.currencyCode,
    notes: f.notes ?? '',
    active: true,
    ...(scheduleChanged(before, f) ? {
      date: f.date,
      repeat_freq: f.repeats ? f.frequency : 'yearly',
      skip: f.repeats ? f.every - 1 : 0,
      end_date: f.repeats ? null : addDays(f.date, 1),
    } : {}),
  };
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function repetitionFor(f: PlannedFields): Record<string, unknown> {
  const dayOfMonth = String(Number(f.date.slice(8, 10)));
  // A one-off happens once, on first_date, whatever the frequency says (a one-off's bill is yearly,
  // so it read back as yearly). A yearly repetition's moment is a date, and FF3 refuses one on an
  // update ("repetitions.0.moment must be a number"): moving a one-off's date always failed.
  if (!f.repeats) return { type: 'monthly', moment: dayOfMonth, skip: 0, weekend: 1 };
  const skip = f.every - 1;
  switch (f.frequency) {
    case 'weekly': return { type: 'weekly', moment: String(isoWeekday(f.date)), skip, weekend: 1 };
    case 'quarterly': return { type: 'monthly', moment: dayOfMonth, skip: 3 * f.every - 1, weekend: 1 };
    case 'half-year': return { type: 'monthly', moment: dayOfMonth, skip: 6 * f.every - 1, weekend: 1 };
    case 'yearly': return { type: 'yearly', moment: f.date, skip, weekend: 1 };
    default: return { type: 'monthly', moment: dayOfMonth, skip, weekend: 1 };
  }
}

/** The end date a repeating planned transaction is given: FF3's API has no "forever". */
export const REPEAT_FOREVER_UNTIL = '2099-12-31';

/**
 * FF3 recurrence body. `transactionId` is the existing recurrence transaction, updated in place;
 * the amount is sent in the planned currency even when the account keeps another (Spotify's
 * 7.99 USD from a PLN account) — the exact PLN amount is set when the transaction is reviewed.
 * FF3's recurrence API reads accounts and the category by id only (it drops the names, and a
 * missing account id fails the save half-way), so `f` must carry both account ids.
 */
export function recurrenceBody(
  f: PlannedFields & { sourceId: string; destinationId: string },
  before: PlannedFields | null,
  opts: { billId?: string | null; transactionId?: string | null; repetitionId?: string | null; categoryId?: string | null },
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
    tags: f.tags,
    ...(opts.billId ? { bill_id: opts.billId } : {}),
  };
  return {
    type: f.type,
    title: f.name,
    notes: withPlannedTime(f.notes, f.time),
    active: true,
    apply_rules: true,
    ...(scheduleChanged(before, f) ? {
      first_date: f.date,
      // FF3 wants exactly one of the two: a key sent as null still counts as sent ("Require
      // either a number of repetitions, or an end date. Not both."). A one-off happens once; a
      // repeating one runs until a date far enough away to mean "until changed".
      ...(f.repeats ? { repeat_until: REPEAT_FOREVER_UNTIL } : { nr_of_repetitions: 1 }),
      repetitions: [{ ...(opts.repetitionId ? { id: opts.repetitionId } : {}), ...repetitionFor(f) }],
    } : {}),
    transactions: [transaction],
  };
}

/** The rule actions the simple view owns; any other action on the rule is kept as it is. */
const MANAGED_ACTIONS = new Set(['link_to_bill', 'set_category', 'set_destination_account', 'set_source_account', 'add_tag']);

export function managedActions(f: PlannedFields): RuleAction[] {
  const action = (type: string, value: string): RuleAction => ({ type, value, active: true, stop_processing: false });
  const out: RuleAction[] = [action('link_to_bill', f.name)];
  if (f.categoryName) out.push(action('set_category', f.categoryName));
  if (f.type === 'withdrawal' && f.destinationName) out.push(action('set_destination_account', f.destinationName));
  if (f.type === 'deposit' && f.sourceName) out.push(action('set_source_account', f.sourceName));
  for (const tag of f.tags) out.push(action('add_tag', tag));
  return out;
}

const cleanTrigger = (t: RuleTrigger): RuleTrigger => ({
  type: t.type, value: t.value, active: t.active ?? true, stop_processing: t.stop_processing ?? false,
  ...(t.prohibited !== undefined ? { prohibited: t.prohibited } : {}),
});
const cleanAction = (a: RuleAction): RuleAction => ({ type: a.type, value: a.value, active: a.active ?? true, stop_processing: a.stop_processing ?? false });

/**
 * FF3 rule body. A new rule matches descriptions containing the name. An existing rule keeps its
 * own triggers (a bank's text for the subscription), with the old name renamed; of its actions,
 * those the simple view owns are replaced and the rest kept.
 */
export function ruleBody(f: PlannedFields, existing: RuleAttributes | null, oldName: string | null, ruleGroupId: string | null): Record<string, unknown> {
  if (!existing) {
    return {
      title: f.name,
      rule_group_id: ruleGroupId,
      trigger: 'store-journal',
      active: true,
      strict: true,
      stop_processing: false,
      triggers: [{ type: 'description_contains', value: f.name, active: true, stop_processing: false }],
      actions: managedActions(f),
    };
  }
  const renamed = (value: string) => (oldName && normkey(value) === normkey(oldName) ? f.name : value);
  return {
    title: f.name,
    triggers: (existing.triggers ?? []).map((t) => cleanTrigger({ ...t, value: renamed(String(t.value ?? '')) })),
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
  return problems;
}
