// What one envelope's wanted amount means as a request to Firefly III. Pure: no db, no fetch, no
// client — the whole of "which verb, which path, which body" is decided here and tested here.
//
// Two of FF3's rules at 6.7.7 shape every branch below:
//  - a budget limit's `amount` is `IsValidPositiveAmount`, strictly greater than zero. There is no
//    such thing as a limit of 0, so "assign nothing" is DELETE, never a write of `0`.
//  - `POST /v1/budgets/{id}/limits` answers 422 `limit_exists` when one already covers that
//    (budget, start, end, currency). The replay therefore reads before it writes, and falls back to
//    a PUT if the answer to its own earlier POST was lost (src/bucket/replay.ts).
import { compareDecimal } from '../api/ff3/decimal';

export type LimitVerdict =
  | { method: 'POST'; path: string; body: Record<string, unknown> }
  | { method: 'PUT'; path: string; body: Record<string, unknown> }
  | { method: 'DELETE'; path: string }
  /** Already what it should be: FF3 is left alone. */
  | { method: 'none' };

export interface LimitWriteInput {
  budgetId: string;
  /** The absolute amount this envelope should hold for the period. */
  wanted: string;
  /** The limit FF3 already has for this (budget, period), if one is known. */
  limitId: string | null;
  /** That limit's current `amount`, so an unchanged assignment sends nothing. */
  currentAmount: string | null;
  periodStart: string;
  periodEnd: string;
  currencyCode: string;
}

export function limitsPath(budgetId: string, limitId?: string | null): string {
  return limitId ? `/v1/budgets/${budgetId}/limits/${limitId}` : `/v1/budgets/${budgetId}/limits`;
}

export function limitWrite(input: LimitWriteInput): LimitVerdict {
  const { budgetId, wanted, limitId, currentAmount } = input;

  // Zero — or a negative asked for by a bug upstream — is "this envelope holds nothing".
  if (compareDecimal(wanted, '0') <= 0) {
    return limitId ? { method: 'DELETE', path: limitsPath(budgetId, limitId) } : { method: 'none' };
  }

  if (!limitId) {
    return {
      method: 'POST',
      path: limitsPath(budgetId),
      body: {
        start: input.periodStart,
        end: input.periodEnd,
        amount: wanted,
        currency_code: input.currencyCode,
      },
    };
  }

  if (currentAmount !== null && compareDecimal(wanted, currentAmount) === 0) {
    return { method: 'none' };
  }

  return { method: 'PUT', path: limitsPath(budgetId, limitId), body: { amount: wanted } };
}
