// Display formatting for FF3 amounts. Decimal strings in, display string out — never a
// `number`, not even for grouping (AGENTS.md: FF3 amounts are strings).
const GROUP = ' '; // narrow no-break space
const MINUS = '−'; // typographic minus, wider than a hyphen

export interface DisplayCurrency {
  symbol: string;
  decimalPlaces: number;
}

function group(whole: string): string {
  let out = '';
  for (let i = whole.length; i > 0; i -= 3) {
    const start = Math.max(0, i - 3);
    out = whole.slice(start, i) + (out ? GROUP + out : '');
  }
  return out || '0';
}

/**
 * `formatMoney('1234.5', { symbol: 'zł', decimalPlaces: 2 })` -> `'1 234,50 zł'`.
 * A fraction longer than the currency's scale is kept, never rounded away silently.
 */
export function formatMoney(amount: string, currency: DisplayCurrency): string {
  const trimmed = (amount ?? '').trim();
  const negative = trimmed.startsWith('-') || trimmed.startsWith(MINUS);
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [rawWhole = '', rawFraction = ''] = unsigned.split('.');
  const whole = rawWhole.replace(/\D/g, '');
  const fraction = rawFraction.replace(/\D/g, '');
  const scaled = fraction.length >= currency.decimalPlaces
    ? fraction
    : fraction.padEnd(currency.decimalPlaces, '0');
  const body = scaled ? `${group(whole)},${scaled}` : group(whole);
  return `${negative ? MINUS : ''}${body}${currency.symbol ? ` ${currency.symbol}` : ''}`;
}

/** The sign a transaction type reads as in a list: spending is neutral, income is `+`. */
export function signFor(type: 'withdrawal' | 'deposit' | 'transfer'): string {
  if (type === 'withdrawal') return MINUS;
  if (type === 'deposit') return '+';
  return '';
}

/**
 * Looks up a currency's display shape from the synced `reference_currencies` cache. A code not
 * yet synced (a draft mid-entry, before the next pull) falls back to 2 decimal places with the
 * code itself as the symbol, rather than failing to render.
 */
export function currencyOf(currencies: { code: string; symbol: string; decimalPlaces: number }[], code: string): DisplayCurrency {
  const found = currencies.find((c) => c.code === code);
  return found ? { symbol: found.symbol, decimalPlaces: found.decimalPlaces } : { symbol: code, decimalPlaces: 2 };
}
