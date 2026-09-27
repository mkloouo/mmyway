// The envelope sweep's maths (design §6.9) — pure, decimal strings, never mixing currencies.
import { addDecimal, isNegative } from '../api/ff3/decimal';

export interface SweepRow {
  accountId: string;
  currencyCode: string;
  expected: string; // the account balance as of the last sync
  counted: string; // what the user typed; '' means not counted
}

export interface SweepAdjustment {
  accountId: string;
  currencyCode: string;
  type: 'withdrawal' | 'deposit';
  amount: string; // unsigned decimal string
}

function isZero(amount: string): boolean {
  return /^-?0*\.?0*$/.test(amount.trim());
}

/**
 * A blank row is skipped (not counted). An equal row produces nothing. Otherwise: short of
 * expected is a withdrawal, over is a deposit — the maths that closes the drift.
 */
export function computeSweep(rows: SweepRow[]): SweepAdjustment[] {
  const adjustments: SweepAdjustment[] = [];
  for (const row of rows) {
    if (!row.counted.trim()) continue;
    const diff = addDecimal(row.counted, `-${row.expected}`); // counted - expected
    if (isZero(diff)) continue;
    adjustments.push({
      accountId: row.accountId,
      currencyCode: row.currencyCode,
      type: isNegative(diff) ? 'withdrawal' : 'deposit',
      amount: isNegative(diff) ? diff.slice(1) : diff,
    });
  }
  return adjustments;
}

/** The footer total (design §6.9): signed drift per currency across every counted envelope,
 * currencies never mixed. */
export function driftByCurrency(rows: SweepRow[]): { currencyCode: string; amount: string }[] {
  const totals = new Map<string, string>();
  for (const row of rows) {
    if (!row.counted.trim()) continue;
    const diff = addDecimal(row.counted, `-${row.expected}`);
    totals.set(row.currencyCode, addDecimal(totals.get(row.currencyCode) ?? '0', diff));
  }
  return [...totals.entries()].map(([currencyCode, amount]) => ({ currencyCode, amount }));
}
