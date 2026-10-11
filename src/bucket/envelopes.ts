// Budgets + their limit for a period + what was spent against them -> the Budget tab's envelopes.
// Pure: decimal strings in, decimal strings out, no db and no fetch.
//
// FF3 returns a limit's `spent` as a NEGATIVE amount, so what is left is `amount + spent` — added,
// never subtracted. A budget with no limit in the period is not broken: it reads as assigned 0 and
// `available = spent`, i.e. unbudgeted spending, which is exactly what happened.
import { addDecimal, compareDecimal } from '../api/ff3/decimal';
import {
  bucketKey,
  type BucketObject,
  type BudgetLimitAttributes,
  type BudgetSpentAttributes,
} from './objects';

export interface Envelope {
  budgetId: string;
  name: string;
  /** The FF3 budget limit backing it, when one exists for this period. */
  limitId: string | null;
  currencyCode: string;
  /**
   * The limit's `amount`. Carry-over lives in here — it is "available this period", not "assigned
   * this month", and it compounds across months you underspend (plan §1). `'0'` with no limit.
   */
  assigned: string;
  /** Negative, as FF3 gives it. */
  spent: string;
  /** `assigned + spent`: what is left to spend. Negative when the envelope is overspent. */
  available: string;
  overspent: boolean;
}

/** FF3 answers `spent` as a string on a limit and as a per-currency array on a budget. */
export function spentAmount(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    return (value as { sum?: unknown }[]).reduce<string>(
      (total, entry) => (typeof entry?.sum === 'string' ? addDecimal(total, entry.sum) : total),
      '0',
    );
  }
  return '0';
}

export function envelopesFor(
  budgets: readonly { id: string; name: string; active: boolean }[],
  objects: readonly BucketObject[],
  periodStart: string,
  fallbackCurrency: string,
): Envelope[] {
  const byKey = new Map(objects.map((o) => [o.key, o]));
  return budgets
    .filter((b) => b.active)
    .map((budget) => {
      const limit = byKey.get(bucketKey('budget_limit', budget.id, periodStart))?.attributes as
        BudgetLimitAttributes | undefined;
      const unbudgeted = byKey.get(bucketKey('budget_spent', budget.id, periodStart))
        ?.attributes as BudgetSpentAttributes | undefined;
      const assigned = limit?.amount ?? '0';
      const spent = spentAmount(limit ? limit.spent : unbudgeted?.spent);
      const available = addDecimal(assigned, spent);
      return {
        budgetId: budget.id,
        name: budget.name,
        limitId: limit ? String(limit.id) : null,
        currencyCode: limit?.currency_code ?? unbudgeted?.currency_code ?? fallbackCurrency,
        assigned,
        spent,
        available,
        overspent: compareDecimal(available, '0') < 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `max(0, available)`: an overspent envelope has already taken its overspend out of the account. */
export function envelopeHeadroom(envelope: Envelope): string {
  return envelope.overspent ? '0' : envelope.available;
}
