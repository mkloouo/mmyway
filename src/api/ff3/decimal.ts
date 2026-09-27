// Minimal fixed-point decimal-string arithmetic. FF3 amounts are decimal strings with up to
// the currency's decimal places; never round-trip through `number`.
function toMinorUnits(value: string): { minor: bigint; scale: number } {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, frac = ''] = unsigned.split('.');
  const scale = frac.length;
  const minor = BigInt((whole || '0') + frac) * (negative ? -1n : 1n);
  return { minor, scale };
}

function fromMinorUnits(minor: bigint, scale: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale) || '0';
  const frac = scale > 0 ? digits.slice(digits.length - scale) : '';
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

export function addDecimal(a: string, b: string): string {
  const left = toMinorUnits(a);
  const right = toMinorUnits(b);
  const scale = Math.max(left.scale, right.scale);
  const leftScaled = left.minor * 10n ** BigInt(scale - left.scale);
  const rightScaled = right.minor * 10n ** BigInt(scale - right.scale);
  return fromMinorUnits(leftScaled + rightScaled, scale);
}

export function isNegative(a: string): boolean {
  return a.trim().startsWith('-');
}

/**
 * `a / b` to `precision` fractional digits, truncated — exact BigInt division, never a float.
 * Display only (the FX implied-rate caption, design §6.2): never feed the result back into a
 * transaction payload. Returns `'0'` for a zero or unparsed denominator rather than throwing.
 */
export function divideDecimal(a: string, b: string, precision: number): string {
  const numerator = toMinorUnits(a);
  const denominator = toMinorUnits(b);
  if (denominator.minor === 0n) return '0';
  const scaleDiff = denominator.scale - numerator.scale + precision;
  const scaledNumerator = scaleDiff >= 0 ? numerator.minor * 10n ** BigInt(scaleDiff) : numerator.minor;
  const scaledDenominator = scaleDiff >= 0 ? denominator.minor : denominator.minor * 10n ** BigInt(-scaleDiff);
  return fromMinorUnits(scaledNumerator / scaledDenominator, precision);
}

export type DecimalInputResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'empty' | 'invalid' | 'too_many_decimals' };

/**
 * The one gate every typed amount goes through before it reaches this file's arithmetic, a draft
 * or the outbox. Accepts what a person types — `12,50`, `12.5`, `1 234,5`, a trailing separator —
 * and returns FF3's canonical form (`12.50`, `1234.5`). Anything else is rejected rather than
 * guessed at: the helpers above call `BigInt()` and throw on a stray comma, and FF3 answers a
 * malformed amount with a 422 that would park in the outbox. Unsigned: the transaction type
 * carries the sign.
 */
export function parseDecimalInput(raw: string, decimalPlaces?: number): DecimalInputResult {
  const compact = raw.replace(/[\s  ]/g, '').replace(',', '.');
  if (compact === '' || compact === '.') return { ok: false, reason: 'empty' };
  const match = /^(\d*)(?:\.(\d*))?$/.exec(compact);
  if (!match) return { ok: false, reason: 'invalid' };
  const whole = (match[1] ?? '').replace(/^0+(?=\d)/, '') || '0';
  const fraction = match[2] ?? '';
  if (decimalPlaces !== undefined && fraction.length > decimalPlaces) return { ok: false, reason: 'too_many_decimals' };
  return { ok: true, value: fraction ? `${whole}.${fraction}` : whole };
}
