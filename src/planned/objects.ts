// FF3's subscriptions (the API still calls them bills), rules and recurring transactions, cached
// in planned_objects for the Planned tab. Only the attributes this app reads are typed; the rest
// is kept as FF3 sent it, for the detailed view.
import { eq } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import { plannedObjects } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';

export type PlannedKind = 'bill' | 'rule' | 'recurrence';

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

type PlannedRow = typeof plannedObjects.$inferSelect;

export function plannedKey(kind: PlannedKind, id: string): string {
  return `${kind}:${id}`;
}

function nameOf(kind: PlannedKind, attributes: Record<string, unknown>): string {
  const value = kind === 'bill' ? attributes.name : attributes.title;
  return typeof value === 'string' ? value : '';
}

/** A cached row back as an object; null when its JSON is unreadable (skipped, not shown broken). */
export function readPlannedRow(row: PlannedRow): PlannedObject | null {
  try {
    const attributes = JSON.parse(row.attributesJson) as Record<string, unknown>;
    if (!attributes || typeof attributes !== 'object') return null;
    return {
      key: row.key,
      kind: row.kind,
      id: row.ff3Id,
      name: row.name,
      attributes,
    } as PlannedObject;
  } catch {
    return null;
  }
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
};
export const plannedPath = (kind: PlannedKind, id?: string) =>
  id ? `${PATHS[kind]}/${id}` : PATHS[kind];

export async function fetchAllOf(
  client: FF3Client,
  kind: PlannedKind,
): Promise<{ id: string; attributes: Record<string, unknown> }[]> {
  const out: { id: string; attributes: Record<string, unknown> }[] = [];
  for (let page = 1; ; page++) {
    const response = await client.request<{
      data: { id: string; attributes: Record<string, unknown> }[];
    }>(`${PATHS[kind]}?limit=100&page=${page}`);
    out.push(...response.data);
    if (response.data.length < 100) return out;
  }
}

/**
 * Replaces the cache with what FF3 has now. All three lists are read before anything is written,
 * so a failed request leaves the old cache in place rather than a partial one.
 */
export async function pullPlanned(db: OutboxDb, client: FF3Client): Promise<void> {
  const [bills, rules, recurrences] = await Promise.all([
    fetchAllOf(client, 'bill'),
    fetchAllOf(client, 'rule'),
    fetchAllOf(client, 'recurrence'),
  ]);
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.delete(plannedObjects).run();
    for (const [kind, list] of [
      ['bill', bills],
      ['rule', rules],
      ['recurrence', recurrences],
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
