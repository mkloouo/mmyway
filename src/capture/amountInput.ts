// The keypad's reducer (design §6.2). Builds a decimal string digit by digit — never through
// `parseFloat` (AGENTS.md). `current` and the return value are always a valid decimal-string
// prefix: no sign (the type carries that), at most one `.`, fraction capped at `decimalPlaces`.
export type KeypadKey =
  '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | ',' | '.' | '⌫';

/**
 * FF3 returns amounts with twelve fraction digits ("12.000000000000"). Editing one on the keypad
 * appended nothing (the fraction was already past the currency's scale) and backspace had to eat
 * ten zeros before anything visible changed. Trailing zeros past the scale are dropped first —
 * lossless, the value is unchanged; a real non-zero digit past the scale is kept.
 */
export function trimToScale(amount: string, decimalPlaces: number): string {
  const [whole = '0', fraction] = amount.split('.');
  if (fraction === undefined || fraction.length <= decimalPlaces) return amount;
  const kept = fraction.replace(/0+$/, '');
  return kept ? `${whole}.${kept}` : whole;
}

export function applyDigit(rawCurrent: string, key: KeypadKey, decimalPlaces: number): string {
  const current = trimToScale(rawCurrent, decimalPlaces);
  if (key === '⌫') {
    if (current === '') return '';
    const next = current.slice(0, -1);
    return next === '' ? '0' : next;
  }

  const hasPoint = current.includes('.');
  const [whole = '0', fraction = ''] = current.split('.');

  if (key === ',' || key === '.') {
    if (hasPoint || decimalPlaces === 0) return current;
    return `${whole}.`;
  }

  if (!/^\d+$/.test(key)) return current; // defensive: unknown key
  const digits = key; // '0'-'9' or the double-zero key '00'

  if (!hasPoint) {
    // Leading zeros collapse: "0" + "5" -> "5", but "0" + "00" stays "0".
    if (/^0+$/.test(digits)) return whole === '0' ? '0' : whole + digits;
    return whole === '0' ? digits : whole + digits;
  }

  const room = decimalPlaces - fraction.length;
  if (room <= 0) return current;
  return `${whole}.${fraction}${digits.slice(0, room)}`;
}

/**
 * The first key pressed on a keypad that opened on an amount already there (a transaction's, a
 * draft's, a split's): a digit or separator starts the sum over, the way tapping a number field
 * selects what's in it, and ⌫ keeps the amount and trims it from the end. Every key after that
 * goes through `applyDigit` as usual — only the first one decides replace or edit.
 */
export function applyFirstKey(current: string, key: KeypadKey, decimalPlaces: number): string {
  return applyDigit(key === '⌫' ? current : '0', key, decimalPlaces);
}
