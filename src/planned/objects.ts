// FF3's subscriptions (the API still calls them bills), rules and recurring transactions, cached
// in planned_objects for the Planned tab. Only the attributes this app reads are typed; the rest
// is kept as FF3 sent it, for the detailed view.
import { eq } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import type { TransactionRead } from '../api/ff3/types';
import { fetchAllPages } from '../api/ff3/paginate';
import { plannedObjects } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';

// A rule group is cached alongside the rules (kind 'rule_group') for the Rules screen. It is not a
// PlannedObject: the Planned tab reads planned_objects through readPlannedRow, which skips it.
export type PlannedKind = 'bill' | 'rule' | 'recurrence' | 'rule_group';

export interface BillAttributes {
  name: string;
  amount_min?: string;
  amount_max?: string;
  currency_code?: string | null;
  date?: string | null;
  end_date?: string | null;
  repeat_freq?: string;
  skip?: number;
  active?: boolean;
  notes?: string | null;
  next_expected_match?: string | null;
  [key: string]: unknown;
}

export interface RuleTrigger {
  type: string;
  value: string;
  active?: boolean;
  stop_processing?: boolean;
  prohibited?: boolean;
  [key: string]: unknown;
}
export interface RuleAction {
  type: string;
  value: string | null;
  active?: boolean;
  stop_processing?: boolean;
  [key: string]: unknown;
}

export interface RuleAttributes {
  title: string;
  rule_group_id?: string | number;
  rule_group_title?: string;
  trigger?: string;
  active?: boolean;
  strict?: boolean;
  triggers?: RuleTrigger[];
  actions?: RuleAction[];
  [key: string]: unknown;
}

export interface RecurrenceRepetition {
  id?: string;
  type: string;
  moment: string;
  skip?: number;
  weekend?: number;
  occurrences?: string[];
  [key: string]: unknown;
}
export interface RecurrenceTransaction {
  id?: string;
  description?: string;
  amount?: string;
  currency_code?: string | null;
  foreign_amount?: string | null;
  source_id?: string | number | null;
  source_name?: string | null;
  destination_id?: string | number | null;
  destination_name?: string | null;
  category_name?: string | null;
  tags?: string[] | null;
  bill_id?: string | number | null;
  [key: string]: unknown;
}

export interface RecurrenceAttributes {
  type?: string;
  title: string;
  description?: string | null;
  first_date?: string;
  latest_date?: string | null;
  repeat_until?: string | null;
  nr_of_repetitions?: number | null;
  active?: boolean;
  notes?: string | null;
  repetitions?: RecurrenceRepetition[];
  transactions?: RecurrenceTransaction[];
  [key: string]: unknown;
}

export type PlannedObject =
  | { key: string; kind: 'bill'; id: string; name: string; attributes: BillAttributes }
  | { key: string; kind: 'rule'; id: string; name: string; attributes: RuleAttributes }
  | { key: string; kind: 'recurrence'; id: string; name: string; attributes: RecurrenceAttributes };

export interface RuleGroupAttributes {
  title: string;
  active?: boolean;
  order?: number;
  [key: string]: unknown;
}

export interface RuleGroupObject {
  key: string;
  kind: 'rule_group';
  id: string;
  name: string;
  attributes: RuleGroupAttributes;
}

export type PlannedRow = typeof plannedObjects.$inferSelect;

export function plannedKey(kind: PlannedKind, id: string): string {
  return `${kind}:${id}`;
}

function nameOf(kind: PlannedKind, attributes: Record<string, unknown>): string {
  const value = kind === 'bill' ? attributes.name : attributes.title;
  return typeof value === 'string' ? value : '';
}

/** A row's JSON as an object; null when it is unreadable or not an object. */
function parseRow(row: PlannedRow): Record<string, unknown> | null {
  try {
    const attributes = JSON.parse(row.attributesJson) as Record<string, unknown>;
    return attributes && typeof attributes === 'object' ? attributes : null;
  } catch {
    return null;
  }
}

/**
 * A cached row back as an object; null when its JSON is unreadable (skipped, not shown broken).
 * A rule group is null here, so every reader of the Planned tab's rows (the tab, the reminders,
 * the bucket's bills) skips it without knowing about it; readRuleGroupRow reads those.
 */
export function readPlannedRow(row: PlannedRow): PlannedObject | null {
  if (row.kind === 'rule_group') return null;
  const attributes = parseRow(row);
  if (!attributes) return null;
  return {
    key: row.key,
    kind: row.kind,
    id: row.ff3Id,
    name: row.name,
    attributes,
  } as PlannedObject;
}

/** A cached rule group back as an object; null for any other row or unreadable JSON. */
export function readRuleGroupRow(row: PlannedRow): RuleGroupObject | null {
  if (row.kind !== 'rule_group') return null;
  const attributes = parseRow(row);
  if (!attributes) return null;
  return {
    key: row.key,
    kind: 'rule_group',
    id: row.ff3Id,
    name: row.name,
    attributes,
  } as RuleGroupObject;
}

function plannedRow(
  kind: PlannedKind,
  id: string,
  attributes: Record<string, unknown>,
  syncedAt: string,
): PlannedRow {
  return {
    key: plannedKey(kind, id),
    kind,
    ff3Id: id,
    name: nameOf(kind, attributes),
    attributesJson: JSON.stringify(attributes),
    syncedAt,
  };
}

const PATHS: Record<PlannedKind, string> = {
  bill: '/v1/bills',
  rule: '/v1/rules',
  recurrence: '/v1/recurrences',
  rule_group: '/v1/rule-groups',
};
export const plannedPath = (kind: PlannedKind, id?: string) =>
  id ? `${PATHS[kind]}/${id}` : PATHS[kind];

/**
 * The transactions Firefly III has already booked from a recurrence, newest first
 * (`GET /v1/recurrences/{id}/transactions`). The "behind" half of the occurrence list: FF3's
 * `repetitions[].occurrences` are future-only, so there is no other way to get at the past ones.
 */
export async function fetchRecurrenceTransactions(
  client: FF3Client,
  recurrenceId: string,
): Promise<TransactionRead[]> {
  const rows = await fetchAllPages<TransactionRead>(
    client,
    `/v1/recurrences/${encodeURIComponent(recurrenceId)}/transactions`,
  );
  return [...rows].sort((a, b) =>
    String(b.attributes.transactions[0]?.date ?? '').localeCompare(
      String(a.attributes.transactions[0]?.date ?? ''),
    ),
  );
}

export async function fetchAllOf(
  client: FF3Client,
  kind: PlannedKind,
): Promise<{ id: string; attributes: Record<string, unknown> }[]> {
  return fetchAllPages<{ id: string; attributes: Record<string, unknown> }>(client, PATHS[kind]);
}

/**
 * Replaces the cache with what FF3 has now. All four lists are read before anything is written,
 * so a failed request leaves the old cache in place rather than a partial one.
 */
export async function pullPlanned(db: OutboxDb, client: FF3Client): Promise<void> {
  const [bills, rules, recurrences, ruleGroups] = await Promise.all([
    fetchAllOf(client, 'bill'),
    fetchAllOf(client, 'rule'),
    fetchAllOf(client, 'recurrence'),
    fetchAllOf(client, 'rule_group'),
  ]);
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.delete(plannedObjects).run();
    for (const [kind, list] of [
      ['bill', bills],
      ['rule', rules],
      ['recurrence', recurrences],
      ['rule_group', ruleGroups],
    ] as const) {
      for (const item of list)
        tx.insert(plannedObjects)
          .values(plannedRow(kind, String(item.id), item.attributes, now))
          .run();
    }
  });
}

/** Stores one object as FF3 just answered it (after a save), or removes it (after a delete). */
export async function storePlanned(
  db: OutboxDb,
  kind: PlannedKind,
  id: string,
  attributes: Record<string, unknown> | null,
): Promise<void> {
  if (!attributes) {
    await db.delete(plannedObjects).where(eq(plannedObjects.key, plannedKey(kind, id)));
    return;
  }
  const row = plannedRow(kind, id, attributes, new Date().toISOString());
  await db
    .insert(plannedObjects)
    .values(row)
    .onConflictDoUpdate({ target: plannedObjects.key, set: row });
}
