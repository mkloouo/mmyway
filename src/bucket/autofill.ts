// "Do what I did last month": spread Ready to Assign over the envelopes, in order, until either
// every one is back to what it held last period or the money runs out. Pure — no db, no fetch.
//
// On the plan's priority order (§3):
//
//  1. Bills due this period come FIRST, and they are honoured by subtraction rather than by an
//     assignment: Ready to Assign already has them deducted (src/bucket/rta.ts), so the money
//     auto-fill is given has the obligations held back out of it. Assigning for them again would
//     reserve them twice. They are also not envelopes — a subscription has no budget limit to write.
//  2. Envelopes, up to last period's assigned amount. No stored per-envelope target in v1: last
//     period's amount IS the target, which is free and needs no new field. When a real target is
//     wanted, the budget's own `notes` is the place, as `mmyway-target: 700.00`, following the
//     `mmyway-time:` precedent in src/planned/plannedTime.ts.
//  3. Sinking funds are left for last and are not filled here: a piggy bank is funded with a
//     different operation (`set_piggy_amount`), not with a budget limit, so it cannot be expressed
//     in these entries. See `fundContributions` below, which Phase 4's screen queues separately.
//  4. Whatever is left over simply stays in Ready to Assign.
//
// Every sum is in the currency's minor units as a BigInt, so the entries can never add up to one
// unit more than Ready to Assign held.
import { fromMinor, toMinor } from '../splits/allocate';
import type { Envelope } from './envelopes';
import type { SetBudgetLimitsEntry } from './replay';

export interface AutofillInput {
  /** What there is to give out. Zero or negative gives nothing. */
  readyToAssign: string;
  /** The open period's envelopes, in the order they should be filled (the screen's own order). */
  envelopes: readonly Envelope[];
  /** The same envelopes as last period held them, by budget id. */
  lastPeriod: ReadonlyMap<string, Envelope>;
  decimalPlaces: number;
}

/**
 * Absolute amounts for the envelopes auto-fill would change, in priority order; `[]` when there is
 * nothing to give or nothing that wants it. Never sums to more than `readyToAssign`.
 */
export function autofill(input: AutofillInput): SetBudgetLimitsEntry[] {
  const dp = input.decimalPlaces;
  let left = toMinor(input.readyToAssign, dp);
  if (left <= 0n) return [];

  const entries: SetBudgetLimitsEntry[] = [];
  for (const envelope of input.envelopes) {
    if (left <= 0n) break;
    const target = input.lastPeriod.get(envelope.budgetId)?.assigned;
    if (!target) continue;
    const assigned = toMinor(envelope.assigned, dp);
    const wanted = toMinor(target, dp) - assigned;
    if (wanted <= 0n) continue;
    const give = wanted < left ? wanted : left;
    left -= give;
    entries.push({
      budgetId: envelope.budgetId,
      amount: fromMinor(assigned + give, dp),
      limitId: envelope.limitId,
    });
  }
  return entries;
}

/** What auto-fill is about to change, as a total, for the confirmation prompt. */
export function autofillTotal(
  entries: readonly SetBudgetLimitsEntry[],
  envelopes: readonly Envelope[],
  decimalPlaces: number,
): string {
  const assignedBy = new Map(envelopes.map((e) => [e.budgetId, e.assigned]));
  const total = entries.reduce((sum, entry) => {
    const before = toMinor(assignedBy.get(entry.budgetId) ?? '0', decimalPlaces);
    return sum + (toMinor(entry.amount, decimalPlaces) - before);
  }, 0n);
  return fromMinor(total, decimalPlaces);
}
