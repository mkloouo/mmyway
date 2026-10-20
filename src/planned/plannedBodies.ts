// Builders that convert PlannedFields into Firefly III request bodies (bills, recurrences, rules).
import { normkey } from '../lookup/normkey';
import { writeMarkers } from './notes';
import { billSchedule, repetitionToFF3, type Repetition } from './repetition';
import { scheduleChanged } from './plannedValidation';
import type { PlannedFields } from './model';
import type { RuleAction, RuleAttributes, RuleTrigger } from './objects';

/** The date "forever" is expressed as on a recurrence: FF3's API has no such thing. */
export const REPEAT_FOREVER_UNTIL = '2099-12-31';

/**
 * The far-future end date a repeating subscription is given. A bill's `end_date` has no `nullable`
 * on update and is capped by `before:2038-01-17` (`Bill/UpdateRequest.php`), so an end date left
 * behind by a one-off cannot be cleared — it is pushed out of the way instead. (`2099-12-31`, which
 * `repeat_until` takes, would be refused here.)
 */
export const BILL_FOREVER_END = '2038-01-16';

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
 * The end condition. FF3 wants exactly one of the two keys and a key sent as null still counts as
 * sent ("Require either a number of repetitions, or an end date. Not both."), so "forever" is a
 * date far enough away to mean "until changed".
 */
export function endBody(f: PlannedFields): Record<string, unknown> {
  if (!f.repeats) return { nr_of_repetitions: 1 };
  if (f.end.kind === 'times') return { nr_of_repetitions: Math.max(2, f.end.count) };
  if (f.end.kind === 'until') return { repeat_until: f.end.date };
  return { repeat_until: REPEAT_FOREVER_UNTIL };
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
