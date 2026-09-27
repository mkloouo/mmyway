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
