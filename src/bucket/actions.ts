// Queues the Budget tab's assignments. Like every other write in the app they go through the
// outbox, so they work offline and reach FF3 in order with everything else.
//
// The screens call these; they never write a table themselves. Every amount handed in is the
// ABSOLUTE amount the envelope should hold afterwards, which is what makes a retry converge.
import { enqueueOperation, type OutboxDb } from '../sync/outbox';
import { generateId } from '../utils/id';
import { addDecimal, compareDecimal, subtractDecimal } from '../api/ff3/decimal';
import type { Envelope } from './envelopes';
import type { Period } from './period';
import type { SetBudgetLimitsEntry, SetBudgetLimitsPayload } from './replay';

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
 * The giver's new amount is reduced by what it gives, so what it has already spent stays covered;
 * `availableFor` is the cap the caller should have enforced, and is clamped here too.
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
