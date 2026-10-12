// The Planned tab's "Out, next 30 days" / "In" card: the coming occurrences added up per currency.
// Withdrawals are out, deposits in. Transfers move money between the user's own accounts and a
// skipped occurrence won't happen, so neither counts. Amounts stay FF3 decimal strings. Pure.
import { addDecimal } from '../api/ff3/decimal';

export interface Totalled {
  /** YYYY-MM-DD */
  day: string;
  skipped: boolean;
  type: 'withdrawal' | 'deposit' | 'transfer';
  amount: string;
  currencyCode: string;
}

interface Totals {
  out: string;
  in: string;
}

/** Per currency code, the sum of the occurrences dated `from`..`until` (both inclusive). */
export function upcomingTotals(
  occurrences: readonly Totalled[],
  window: { from: string; until: string },
): Record<string, Totals> {
  const totals: Record<string, Totals> = {};
  for (const o of occurrences) {
    if (o.skipped || o.type === 'transfer') continue;
    if (o.day < window.from || o.day > window.until) continue;
    let row = totals[o.currencyCode];
    if (!row) {
      row = { out: '0', in: '0' };
      totals[o.currencyCode] = row;
    }
    if (o.type === 'withdrawal') row.out = addDecimal(row.out, o.amount);
    else row.in = addDecimal(row.in, o.amount);
  }
  return totals;
}
