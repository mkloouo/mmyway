// "Do what I did last month": spread Ready to Assign over the envelopes and the sinking funds, in
// the plan's priority order, until either everything is topped up or the money runs out. Pure — no
// db, no fetch.
//
// The order (plan §3), and why each step looks the way it does:
//
//  1. Bills due this period come FIRST, and they are honoured by subtraction rather than by an
//     assignment: Ready to Assign already has them deducted (src/bucket/rta.ts), so the money this
//     function is given has the obligations held back out of it already. Assigning for them again
//     would reserve them twice. They are also not envelopes — a subscription has no budget limit.
//  2. Envelopes, up to last period's assigned amount. No stored per-envelope target in v1: last
//     period's amount IS the target, which is free and needs no new field. When a real target is
//     wanted, the budget's own `notes` is the place, as `mmyway-target: 700.00`, following the
//     `mmyway-time:` precedent in src/planned/plannedTime.ts.
//  3. Sinking funds, each by (target − saved) / months until its target date. A fund with no target
//     has no rate to derive and is left alone. These are a different operation from the envelopes
//     (`set_piggy_amount`, not a budget limit), which is why the plan keeps the two lists apart.
//  4. Whatever is left simply stays in Ready to Assign.
//
// Every sum is in the currency's minor units as a BigInt, so the plan can never hand out one unit
// more than Ready to Assign held.
import { fromMinor, toMinor } from '../splits/allocate';
import type { Envelope } from './envelopes';
import type { Fund } from './funds';
import type { SetBudgetLimitsEntry, SetPiggyAmountPayload } from './replay';

export interface AutofillInput {
  /** What there is to give out. Zero or negative gives nothing. */
  readyToAssign: string;
  /** The open period's envelopes, in the order they should be filled (the screen's own order). */
  envelopes: readonly Envelope[];
  /** The same envelopes as last period held them, by budget id. */
  lastPeriod: ReadonlyMap<string, Envelope>;
  funds: readonly Fund[];
  /** YYYY-MM-DD, for "how many months until the target date". */
  today: string;
  decimalPlaces: number;
}

export interface AutofillPlan {
  /** Absolute amounts for the envelopes to change; one `set_budget_limits` operation. */
  envelopes: SetBudgetLimitsEntry[];
  /** Absolute saved amounts for the funds to top up; one `set_piggy_amount` operation each. */
  funds: SetPiggyAmountPayload[];
  /** What the plan hands out in total — what the confirmation prompt shows. */
  total: string;
  /** What stays in Ready to Assign afterwards. */
  leftover: string;
}

const EMPTY: AutofillPlan = { envelopes: [], funds: [], total: '0', leftover: '0' };

export function autofill(input: AutofillInput): AutofillPlan {
  const dp = input.decimalPlaces;
  const budget = toMinor(input.readyToAssign, dp);
  if (budget <= 0n) return { ...EMPTY, leftover: fromMinor(budget > 0n ? budget : 0n, dp) };

  let left = budget;
  const envelopes: SetBudgetLimitsEntry[] = [];
  for (const envelope of input.envelopes) {
    if (left <= 0n) break;
    const target = input.lastPeriod.get(envelope.budgetId)?.assigned;
    if (!target) continue;
    const assigned = toMinor(envelope.assigned, dp);
    const wanted = toMinor(target, dp) - assigned;
    if (wanted <= 0n) continue;
    const give = wanted < left ? wanted : left;
    left -= give;
    envelopes.push({
      budgetId: envelope.budgetId,
      amount: fromMinor(assigned + give, dp),
      limitId: envelope.limitId,
    });
  }

  const funds: SetPiggyAmountPayload[] = [];
  for (const fund of input.funds) {
    if (left <= 0n) break;
    // No target, or no account to write against: nothing to work a monthly share out of.
    if (!fund.target || !fund.accountId) continue;
    const saved = toMinor(fund.saved, dp);
    const shortfall = toMinor(fund.target, dp) - saved;
    if (shortfall <= 0n) continue;
    const months = BigInt(monthsUntil(input.today, fund.targetDate));
    // Rounded up, so the last month is never short by a minor unit.
    const share = (shortfall + months - 1n) / months;
    const give = share < left ? share : left;
    if (give <= 0n) continue;
    left -= give;
    funds.push({
      piggyId: fund.id,
      accountId: fund.accountId,
      amount: fromMinor(saved + give, dp),
      ...(fund.updatedAt ? { expectedUpdatedAt: fund.updatedAt } : {}),
    });
  }

  return {
    envelopes,
    funds,
    total: fromMinor(budget - left, dp),
    leftover: fromMinor(left, dp),
  };
}

/** How many whole months from `today` to `target`; at least one, and one for no target date. */
function monthsUntil(today: string, target: string | null): number {
  if (!target) return 1;
  const [ty, tm] = today.split('-').map(Number);
  const [y, m] = target.split('-').map(Number);
  const months = ((y ?? 0) - (ty ?? 0)) * 12 + ((m ?? 0) - (tm ?? 0));
  return months > 1 ? months : 1;
}

/** Whether the plan would change anything at all. */
export function autofillIsEmpty(plan: AutofillPlan): boolean {
  return plan.envelopes.length === 0 && plan.funds.length === 0;
}

/** How many things the plan touches, for the confirmation prompt's count. */
export function autofillCount(plan: AutofillPlan): number {
  return plan.envelopes.length + plan.funds.length;
}
