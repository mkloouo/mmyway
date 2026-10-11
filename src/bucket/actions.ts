// Queues the Budget tab's assignments. Like every other write in the app they go through the
// outbox, so they work offline and reach FF3 in order with everything else.
//
// The screens call these; they never write a table themselves. Every amount handed in is the
// ABSOLUTE amount the envelope should hold afterwards, which is what makes a retry converge.
import { enqueueOperation, type OutboxDb } from '../sync/outbox';
import { generateId } from '../utils/id';
import { addDecimal, compareDecimal, subtractDecimal } from '../api/ff3/decimal';
import type { Envelope } from './envelopes';
import type { Fund } from './funds';
import type { Period } from './period';
import type { SetBudgetLimitsEntry, SetBudgetLimitsPayload, SetPiggyAmountPayload } from './replay';

function queue(
  db: OutboxDb,
  period: Period,
  currencyCode: string,
  entries: SetBudgetLimitsEntry[],
): Promise<void> {
  const payload: SetBudgetLimitsPayload = {
    periodStart: period.start,
    periodEnd: period.end,
    currencyCode,
    entries,
  };
  return enqueueOperation(db, { id: generateId(), kind: 'set_budget_limits', payload });
}

/** Set one envelope to `amount` for the period. `'0'` empties it (the limit is deleted). */
export async function assignToEnvelope(
  db: OutboxDb,
  period: Period,
  currencyCode: string,
  envelope: Pick<Envelope, 'budgetId' | 'limitId'>,
  amount: string,
): Promise<void> {
  await queue(db, period, currencyCode, [
    { budgetId: envelope.budgetId, amount, limitId: envelope.limitId },
  ]);
}

/**
 * Move `amount` from one envelope to another — ONE operation with both absolute amounts, never two.
 * Queued separately, a landed decrement with a failed increment would lose the money from the
 * budget with nothing left to put it back.
 *
 * The giver's new amount is reduced by what it gives, and the move is clamped to what it actually
 * has left (`available`, not `assigned`), so what it has already spent stays covered.
 */
export async function moveBetweenEnvelopes(
  db: OutboxDb,
  period: Period,
  currencyCode: string,
  from: Pick<Envelope, 'budgetId' | 'limitId' | 'assigned' | 'available'>,
  to: Pick<Envelope, 'budgetId' | 'limitId' | 'assigned'>,
  amount: string,
): Promise<void> {
  const moved = compareDecimal(amount, from.available) > 0 ? from.available : amount;
  if (compareDecimal(moved, '0') <= 0) return;
  await queue(db, period, currencyCode, [
    {
      budgetId: from.budgetId,
      amount: subtractDecimal(from.assigned, moved),
      limitId: from.limitId,
    },
    { budgetId: to.budgetId, amount: addDecimal(to.assigned, moved), limitId: to.limitId },
  ]);
}

/** Auto-fill: many envelopes, one operation, each an absolute amount (src/bucket/autofill.ts). */
export async function assignMany(
  db: OutboxDb,
  period: Period,
  currencyCode: string,
  entries: SetBudgetLimitsEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await queue(db, period, currencyCode, entries);
}

/**
 * Set a sinking fund's saved amount. Absolute, and carrying the piggy bank's `updated_at` so the
 * replay refuses to overwrite a change made in Firefly III's own web UI meanwhile.
 *
 * Clamped to the fund's target here as well as in the replay: FF3 would clamp it silently, and the
 * number on screen has to be the number that gets saved.
 */
export async function setFundAmount(
  db: OutboxDb,
  fund: Pick<Fund, 'id' | 'accountId' | 'target' | 'updatedAt'>,
  amount: string,
): Promise<void> {
  // No linked account means no field to write: FF3 stores a piggy's amount per account.
  if (!fund.accountId) return;
  const wanted = fund.target && compareDecimal(amount, fund.target) > 0 ? fund.target : amount;
  const payload: SetPiggyAmountPayload = {
    piggyId: fund.id,
    accountId: fund.accountId,
    amount: compareDecimal(wanted, '0') < 0 ? '0' : wanted,
    ...(fund.updatedAt ? { expectedUpdatedAt: fund.updatedAt } : {}),
  };
  await enqueueOperation(db, { id: generateId(), kind: 'set_piggy_amount', payload });
}

/** Auto-fill's fund half: one operation per fund, each already absolute and conflict-checked. */
export async function fundMany(
  db: OutboxDb,
  payloads: readonly SetPiggyAmountPayload[],
): Promise<void> {
  for (const payload of payloads)
    await enqueueOperation(db, { id: generateId(), kind: 'set_piggy_amount', payload });
}
