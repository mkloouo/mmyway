// The Budget tab's pull: FF3's budget limits, per-budget spending and piggy banks into
// bucket_objects. Five requests, so it runs in the full-sync path only (src/sync/runSync.ts).
//
// Two windows are read, not one — the open period and the one before it — so "what you assigned
// last month" (the auto-fill default, plan §3) needs no extra round trip. They are read as separate
// requests on purpose: FF3 enriches `spent` from the request's own start/end, so one wide window
// would hand both months the same two-month total.
//
// Everything is read before anything is written, the same rule as pullPlanned: a failed request
// leaves the previous cache whole rather than half-replaced.
import type { FF3Client } from '../api/ff3/client';
import { fetchAllPages } from '../api/ff3/paginate';
import { bucketObjects, plannedObjects } from '../db/schema';
import type { OutboxDb } from './outbox';
import { bucketRow } from '../bucket/objects';
import { spentAmount } from '../bucket/envelopes';
import { inPeriod, periodOf, previousPeriod, type Period } from '../bucket/period';
import { readPlannedRow, type BillAttributes } from '../planned/objects';
import { localDay } from '../utils/day';

type Read = { id: string | number; attributes: Record<string, unknown> };

const range = (period: Period) => `start=${period.start}&end=${period.end}`;

/** The periods one pull covers: the open one and the one before it. */
export function pulledPeriods(today: string = localDay()): [Period, Period] {
  const open = periodOf(today);
  return [open, previousPeriod(open)];
}

async function readPeriod(
  client: FF3Client,
  period: Period,
): Promise<{ period: Period; budgets: Read[]; limits: Read[] }> {
  const [budgets, limits] = await Promise.all([
    fetchAllPages<Read>(client, `/v1/budgets?${range(period)}`),
    fetchAllPages<Read>(client, `/v1/budget-limits?${range(period)}`),
  ]);
  return { period, budgets, limits };
}

export async function pullBucketData(
  db: OutboxDb,
  client: FF3Client,
  today: string = localDay(),
): Promise<void> {
  const [open, previous] = pulledPeriods(today);
  const [periods, piggies] = await Promise.all([
    Promise.all([readPeriod(client, open), readPeriod(client, previous)]),
    fetchAllPages<Read>(client, '/v1/piggy-banks'),
  ]);

  const now = new Date().toISOString();
  const rows: (typeof bucketObjects.$inferSelect)[] = [];
  for (const { period, budgets, limits } of periods) {
    const funded = new Set<string>();
    for (const limit of limits) {
      const a = limit.attributes as { budget_id?: unknown; start?: unknown };
      const budgetId = a.budget_id != null ? String(a.budget_id) : null;
      // FF3's budget-limits query takes a window, and a repository call behind it can answer with
      // a limit that only partly overlaps it (plan §6.1). Only a limit that starts this period is
      // this period's; anything else would be read as an assignment the user never made.
      if (!budgetId || String(a.start ?? '').slice(0, 10) !== period.start) continue;
      funded.add(budgetId);
      rows.push(
        bucketRow(
          'budget_limit',
          budgetId,
          period.start,
          { ...limit.attributes, id: String(limit.id) },
          now,
        ),
      );
    }
    // A budget with no limit still shows what was spent against it, so an overspend on an unfunded
    // envelope is visible rather than silently zero.
    for (const budget of budgets) {
      const id = String(budget.id);
      if (funded.has(id)) continue;
      const spent = spentAmount(budget.attributes.spent);
      if (spent === '0') continue;
      const currency = (budget.attributes.spent as { currency_code?: string }[] | undefined)?.[0]
        ?.currency_code;
      rows.push(
        bucketRow(
          'budget_spent',
          id,
          period.start,
          { spent, ...(currency ? { currency_code: currency } : {}) },
          now,
        ),
      );
    }
  }
  for (const piggy of piggies)
    rows.push(bucketRow('piggy', String(piggy.id), null, piggy.attributes, now));

  db.transaction((tx) => {
    tx.delete(bucketObjects).run();
    for (const row of rows) tx.insert(bucketObjects).values(row).run();
  });
}

export interface BillDue {
  billId: string;
  name: string;
  amount: string;
  currencyCode: string | null;
  date: string;
}

/**
 * The fixed obligations the Budget tab rolls up: bills FF3 expects to be paid in `period` and has
 * not matched a payment for yet. Pure, over the Planned tab's own cached rows — the Budget tab
 * reads `planned_objects` through this function, so src/bucket/ never imports src/planned/ and
 * `npm run analyze:cycles` stays clean.
 *
 * `next_expected_match` is FF3's own answer to "when is this next due, given what has been paid",
 * so a bill already settled this period has moved on to the next one and drops out by itself.
 * ponytail: a bill due twice in one period counts once; read `pay_dates`/`paid_dates` (which need
 * a dated /v1/bills pull) if that ever matters.
 */
export function billsDueIn(
  rows: readonly (typeof plannedObjects.$inferSelect)[],
  period: Period,
): BillDue[] {
  const due: BillDue[] = [];
  for (const row of rows) {
    if (row.kind !== 'bill') continue;
    const read = readPlannedRow(row);
    if (!read || read.kind !== 'bill') continue;
    const a = read.attributes as BillAttributes;
    const date = a.next_expected_match;
    const amount = a.amount_max ?? a.amount_min;
    if (a.active === false || !date || !amount || !inPeriod(period, date)) continue;
    due.push({
      billId: read.id,
      name: read.name,
      amount,
      currencyCode: a.currency_code ?? null,
      date: date.slice(0, 10),
    });
  }
  return due.sort((x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name));
}
