// Physical denominations are facts about a currency, not user data — a small static table
// (design §6.9). An unknown currency simply has no 🧮; the field stays typed as usual.
import { addDecimal } from '../api/ff3/decimal';

interface Denomination {
  value: string; // decimal string, one unit of this note/coin
  label: string; // display label
}

const LADDERS: Record<string, Denomination[]> = {
  PLN: [
    { value: '500.00', label: '500' },
    { value: '200.00', label: '200' },
    { value: '100.00', label: '100' },
    { value: '50.00', label: '50' },
    { value: '20.00', label: '20' },
    { value: '10.00', label: '10' },
    { value: '5.00', label: '5' },
    { value: '2.00', label: '2' },
    { value: '1.00', label: '1' },
    { value: '0.50', label: '0,50' },
    { value: '0.20', label: '0,20' },
    { value: '0.10', label: '0,10' },
    { value: '0.05', label: '0,05' },
    { value: '0.02', label: '0,02' },
    { value: '0.01', label: '0,01' },
  ],
  EUR: [
    { value: '500.00', label: '500' },
    { value: '200.00', label: '200' },
    { value: '100.00', label: '100' },
    { value: '50.00', label: '50' },
    { value: '20.00', label: '20' },
    { value: '10.00', label: '10' },
    { value: '5.00', label: '5' },
    { value: '2.00', label: '2' },
    { value: '1.00', label: '1' },
    { value: '0.50', label: '0.50' },
    { value: '0.20', label: '0.20' },
    { value: '0.10', label: '0.10' },
    { value: '0.05', label: '0.05' },
    { value: '0.02', label: '0.02' },
    { value: '0.01', label: '0.01' },
  ],
  USD: [
    { value: '100.00', label: '100' },
    { value: '50.00', label: '50' },
    { value: '20.00', label: '20' },
    { value: '10.00', label: '10' },
    { value: '5.00', label: '5' },
    { value: '1.00', label: '1' },
    { value: '0.25', label: '0.25' },
    { value: '0.10', label: '0.10' },
    { value: '0.05', label: '0.05' },
    { value: '0.01', label: '0.01' },
  ],
  UAH: [
    { value: '1000.00', label: '1000' },
    { value: '500.00', label: '500' },
    { value: '200.00', label: '200' },
    { value: '100.00', label: '100' },
    { value: '50.00', label: '50' },
    { value: '20.00', label: '20' },
    { value: '10.00', label: '10' },
    { value: '5.00', label: '5' },
    { value: '2.00', label: '2' },
    { value: '1.00', label: '1' },
    { value: '0.50', label: '0,50' },
  ],
};

/** A ladder from face values, largest first; labels show whole units bare and cents with a point. */
function ladder(values: string[], decimals = 2): Denomination[] {
  return values.map((v) => ({
    value: v.includes('.') || decimals === 0 ? v : `${v}.00`,
    label: v,
  }));
}

// Currencies beyond the four above, for people outside Poland/Ukraine (review: "note
// denominations for four currencies"). Notes and coins in circulation as of 2026.
Object.assign(LADDERS, {
  GBP: ladder(['50', '20', '10', '5', '2', '1', '0.50', '0.20', '0.10', '0.05', '0.02', '0.01']),
  CHF: ladder([
    '1000',
    '200',
    '100',
    '50',
    '20',
    '10',
    '5',
    '2',
    '1',
    '0.50',
    '0.20',
    '0.10',
    '0.05',
  ]),
  CZK: ladder(['5000', '2000', '1000', '500', '200', '100', '50', '20', '10', '5', '2', '1']),
  HUF: ladder([
    '20000',
    '10000',
    '5000',
    '2000',
    '1000',
    '500',
    '200',
    '100',
    '50',
    '20',
    '10',
    '5',
  ]),
  SEK: ladder(['1000', '500', '200', '100', '50', '20', '10', '5', '2', '1']),
  NOK: ladder(['1000', '500', '200', '100', '50', '20', '10', '5', '1']),
  DKK: ladder(['1000', '500', '200', '100', '50', '20', '10', '5', '2', '1', '0.50']),
  RON: ladder(['500', '200', '100', '50', '10', '5', '1', '0.50', '0.10', '0.05', '0.01']),
  CAD: ladder(['100', '50', '20', '10', '5', '2', '1', '0.25', '0.10', '0.05']),
  JPY: ladder(['10000', '5000', '2000', '1000', '500', '100', '50', '10', '5', '1'], 0), // no minor unit
});

export function denominationsFor(currencyCode: string): Denomination[] | null {
  return LADDERS[currencyCode.toUpperCase()] ?? null;
}

/** Multiplies counts into a total (design §6.9's 🧮) — repeated `addDecimal`, never a float. */
export function totalDenominations(counts: Record<string, number>, ladder: Denomination[]): string {
  let total = '0';
  for (const denom of ladder) {
    const count = counts[denom.value] ?? 0;
    for (let i = 0; i < count; i++) total = addDecimal(total, denom.value);
  }
  return total;
}
