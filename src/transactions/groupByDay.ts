// Groups cached transactions by local calendar day, newest first, with a per-currency day total
// (design §6.4). Pure, decimal strings only — totals go through `addDecimal`, never a float.
import { addDecimal } from '../api/ff3/decimal';

export interface DayTransaction {
  groupId: string;
  date: string; // ISO 8601
  amount: string;
  currencyCode: string;
  type: 'withdrawal' | 'deposit' | 'transfer';
}

export interface DayTotal {
  currencyCode: string;
  amount: string; // signed: withdrawal subtracts, deposit adds
}

export interface DaySection<T extends DayTransaction> {
  key: string; // local YYYY-MM-DD
  totals: DayTotal[];
  data: T[];
}

function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * A transfer moves money between the user's own accounts — it contributes to neither the day's
 * spend nor its income, so it is excluded from the total (still listed in `data`, unsummed).
 */
export function groupByDay<T extends DayTransaction>(rows: T[]): DaySection<T>[] {
  const sorted = [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const byDay = new Map<string, T[]>();
  for (const row of sorted) {
    const key = localDayKey(new Date(row.date));
    const list = byDay.get(key);
    if (list) list.push(row);
    else byDay.set(key, [row]);
  }

  return [...byDay.entries()].map(([key, data]) => {
    const totalsByCurrency = new Map<string, string>();
    for (const row of data) {
      if (row.type === 'transfer') continue;
      const signed = row.type === 'withdrawal' ? `-${row.amount}` : row.amount;
      totalsByCurrency.set(
        row.currencyCode,
        addDecimal(totalsByCurrency.get(row.currencyCode) ?? '0', signed),
      );
    }
    return {
      key,
      data,
      totals: [...totalsByCurrency.entries()].map(([currencyCode, amount]) => ({
        currencyCode,
        amount,
      })),
    };
  });
}
