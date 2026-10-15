// Display formatting for FF3 amounts. Decimal strings in, display string out — never a
// `number`, not even for grouping (AGENTS.md: FF3 amounts are strings). The separators are the
// phone's own number format (Android's region settings), not a hardcoded Polish "1 234,50".
import { getLocales } from 'expo-localization';
import { appLocale } from '../i18n';

const NARROW_NBSP = '\u202F';
const MINUS = '−'; // typographic minus, wider than a hyphen

export interface NumberSeparators {
  group: string;
  decimal: string;
}

let deviceSeparatorsCache: NumberSeparators | null = null;

/** The phone's digit grouping and decimal separators, read once. */
function deviceSeparators(): NumberSeparators {
  if (deviceSeparatorsCache) return deviceSeparatorsCache;
  const locale = getLocales()[0];
  const decimal = locale?.decimalSeparator || '.';
  const rawGroup = locale?.digitGroupingSeparator ?? (decimal === ',' ? ' ' : ',');
  // A plain or no-break space would let "1 234" wrap across lines; the narrow no-break one can't.
  const group = /^\s$/.test(rawGroup) || rawGroup === '\u00A0' ? NARROW_NBSP : rawGroup;
  deviceSeparatorsCache = { group, decimal };
  return deviceSeparatorsCache;
}

export interface DisplayCurrency {
  symbol: string;
  decimalPlaces: number;
}

const knownCurrencySymbols = new Map<string, string>();

/**
 * Registers custom currency symbols from Firefly III's synced reference data.
 */
export function registerCurrencySymbols(
  currencies: { code: string; symbol?: string | null }[],
): void {
  for (const c of currencies) {
    if (c.code && c.symbol) {
      knownCurrencySymbols.set(c.code.toUpperCase(), c.symbol);
    }
  }
}

/**
 * Returns the currency symbol for a currency code (e.g. "PLN" -> "zł", "EUR" -> "€", "USD" -> "$").
 * If the currency is known in FF3's synced referenceCurrencies with a symbol, that is used.
 * Otherwise uses `Intl.NumberFormat(appLocale(), { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })`.
 * If that returns the code itself or is unknown/crypto, falls back to the ISO code.
 */
export function currencySymbol(
  code: string | null | undefined,
  currencies?: { code: string; symbol?: string | null }[],
): string {
  if (!code) return '';
  const trimmed = code.trim();
  if (!trimmed) return '';

  if (currencies && currencies.length > 0) {
    registerCurrencySymbols(currencies);
    const found = currencies.find(
      (c) => c.code === trimmed || c.code.toUpperCase() === trimmed.toUpperCase(),
    );
    if (found?.symbol) return found.symbol;
  }

  const cached = knownCurrencySymbols.get(trimmed.toUpperCase());
  if (cached) return cached;

  try {
    const parts = new Intl.NumberFormat(appLocale(), {
      style: 'currency',
      currency: trimmed.toUpperCase(),
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(1);
    const symbol = parts.find((p) => p.type === 'currency')?.value;
    if (symbol) return symbol;
  } catch {
    // RangeError if currency code is not a valid ISO 4217 code
  }

  return trimmed;
}

function group(whole: string, separator: string): string {
  let out = '';
  for (let i = whole.length; i > 0; i -= 3) {
    const start = Math.max(0, i - 3);
    out = whole.slice(start, i) + (out ? separator + out : '');
  }
  return out || '0';
}

/**
 * `formatMoney('1234.5', { symbol: 'zł', decimalPlaces: 2 })` -> `'1 234,50 zł'` on a phone set to
 * Polish number format, `'1,234.50 zł'` on one set to English (US).
 * A fraction longer than the currency's scale is kept, never rounded away silently.
 */
export function formatMoney(
  amount: string,
  currency: DisplayCurrency,
  separators: NumberSeparators = deviceSeparators(),
): string {
  const trimmed = (amount ?? '').trim();
  const negative = trimmed.startsWith('-') || trimmed.startsWith(MINUS);
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [rawWhole = '', rawFraction = ''] = unsigned.split('.');
  const whole = rawWhole.replace(/\D/g, '');
  const fraction = rawFraction.replace(/\D/g, '');
  const trimmedFraction = fraction.replace(/0+$/, '');
  const scaled =
    trimmedFraction.length >= currency.decimalPlaces
      ? trimmedFraction
      : trimmedFraction.padEnd(currency.decimalPlaces, '0');
  const body = scaled
    ? `${group(whole, separators.group)}${separators.decimal}${scaled}`
    : group(whole, separators.group);

  const sym = currencySymbol(currency.symbol);
  return `${negative ? MINUS : ''}${body}${sym ? ` ${sym}` : ''}`;
}

/**
 * Echoes a keypad string as it is being typed: the whole part grouped, the fraction exactly as
 * entered, a bare trailing separator kept. `formatMoney` pads the fraction to the currency's
 * scale, which hid every keystroke behind "0,00" until the user reached that many digits.
 */
export function formatAmountInput(
  amount: string,
  currency: DisplayCurrency,
  separators: NumberSeparators = deviceSeparators(),
): string {
  const [rawWhole = '', rawFraction] = amount.split('.');
  const whole = group(rawWhole.replace(/\D/g, ''), separators.group);
  const body =
    rawFraction === undefined
      ? whole
      : `${whole}${separators.decimal}${rawFraction.replace(/\D/g, '')}`;
  const sym = currencySymbol(currency.symbol);
  return `${body}${sym ? ` ${sym}` : ''}`;
}

/** The sign a transaction type reads as in a list: spending is neutral, income is `+`. */
export function signFor(type: 'withdrawal' | 'deposit' | 'transfer'): string {
  if (type === 'withdrawal') return MINUS;
  if (type === 'deposit') return '+';
  return '';
}

/**
 * Looks up a currency's display shape from the synced `reference_currencies` cache.
 * Falls back to `currencySymbol` and 2 decimal places when unsynced, ensuring currency
 * symbols (zł, €, $) render consistently everywhere.
 */
export function currencyOf(
  currencies: { code: string; symbol: string; decimalPlaces: number }[],
  code: string,
): DisplayCurrency {
  if (currencies.length > 0) {
    registerCurrencySymbols(currencies);
  }
  const found = currencies.find((c) => c.code === code);
  return {
    symbol: found?.symbol || currencySymbol(code, currencies),
    decimalPlaces: found?.decimalPlaces ?? 2,
  };
}

/**
 * Single-line FX rate caption reading account currency first: "1 € ≈ 4.31 zł",
 * where `accountCcy` is the account that paid and `entryCcy` is the entry currency.
 */
export function fxCaption(accountCcy: string, entryCcy: string, rate: string | number): string {
  return `1 ${accountCcy} ≈ ${rate} ${entryCcy}`;
}
