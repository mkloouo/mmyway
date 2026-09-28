// The arithmetic behind a split transaction's tracked total (the Split button, the total above the
// splits). Pure, decimal strings in and out — every sum is done in the currency's minor units as a
// BigInt, never a float (AGENTS.md: FF3 amounts are strings).
//
// One idea serves every case: an amount has to be moved between the splits and "the rest", and
// sliders say how much each split gives or gets. A new split takes its amount from the existing
// ones; a changed total spreads the difference over the splits; a changed split amount spreads the
// difference over the others. `balance` keeps the sliders summing to the amount at all times.

/** `'12.5'` at 2 decimal places -> `1250n`. Extra fraction digits past the scale are cut. */
export function toMinor(amount: string, decimalPlaces: number): bigint {
  const trimmed = amount.trim();
  const negative = trimmed.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.');
  const digits = `${whole || '0'}${fraction.padEnd(decimalPlaces, '0').slice(0, decimalPlaces)}`;
  const value = BigInt(digits.replace(/\D/g, '') || '0');
  return negative ? -value : value;
}

/** `1250n` at 2 decimal places -> `'12.50'`. */
export function fromMinor(minor: bigint, decimalPlaces: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(decimalPlaces + 1, '0');
  const whole = digits.slice(0, digits.length - decimalPlaces);
  const fraction = decimalPlaces > 0 ? `.${digits.slice(digits.length - decimalPlaces)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

export function sumMinor(amounts: readonly string[], decimalPlaces: number): bigint {
  return amounts.reduce((acc, a) => acc + toMinor(a, decimalPlaces), 0n);
}

/** What the total says minus what the splits add up to: positive means money nobody has yet. */
export function leftover(total: string, amounts: readonly string[], decimalPlaces: number): bigint {
  return toMinor(total, decimalPlaces) - sumMinor(amounts, decimalPlaces);
}

/**
 * Default shares of `target` across slots that can each hold up to `caps[i]`: filled in order, the
 * first slot first — the first split is the "main" one, so by default a new split takes its money
 * from there and nothing else moves. Returns null when the caps together can't hold the target.
 */
export function defaultShares(target: bigint, caps: readonly bigint[]): bigint[] | null {
  let rest = target;
  const shares = caps.map((cap) => {
    const take = rest < cap ? rest : cap;
    rest -= take > 0n ? take : 0n;
    return take > 0n ? take : 0n;
  });
  return rest === 0n ? shares : null;
}

/**
 * A slider moved: slot `index` asks for `wanted`. The other slots give way (in order, first
 * split first) so the shares still sum to `target`; when they can't give enough, the moved one
 * is held back to what fits. Every share stays within 0..cap.
 */
export function balance(shares: readonly bigint[], caps: readonly bigint[], target: bigint, index: number, wanted: bigint): bigint[] {
  const next = [...shares];
  const cap = caps[index] ?? 0n;
  let value = wanted < 0n ? 0n : wanted > cap ? cap : wanted;
  if (value > target) value = target;
  // What the others can hold at most, and at least (zero): the moved slot must leave them a
  // total they can reach.
  const othersCap = caps.reduce((acc, c, i) => (i === index ? acc : acc + c), 0n);
  if (target - value > othersCap) value = target - othersCap;
  next[index] = value;

  let diff = target - next.reduce((acc, s) => acc + s, 0n); // > 0: others must grow; < 0: shrink
  for (let i = 0; i < next.length && diff !== 0n; i++) {
    if (i === index) continue;
    const current = next[i] ?? 0n;
    if (diff > 0n) {
      const room = (caps[i] ?? 0n) - current;
      const add = diff < room ? diff : room;
      next[i] = current + add;
      diff -= add;
    } else {
      const give = -diff < current ? -diff : current;
      next[i] = current - give;
      diff += give;
    }
  }
  return next;
}

/**
 * Applies the shares to the split amounts: `sign` -1 takes them away (a new split's amount, a
 * lowered total), +1 adds them (a raised total, a lowered split's difference).
 */
export function applyShares(amounts: readonly string[], shares: readonly bigint[], sign: 1 | -1, decimalPlaces: number): string[] {
  return amounts.map((a, i) => fromMinor(toMinor(a, decimalPlaces) + BigInt(sign) * (shares[i] ?? 0n), decimalPlaces));
}

/**
 * How much each split can give or take when `delta` (leftover: total minus the splits' sum) is
 * spread over them. Money going to the splits (delta > 0) has no cap but the delta itself; money
 * taken from them leaves each at least one minor unit, since a split of zero isn't a split.
 * `exclude` is the split whose amount was just typed — it keeps what the user entered.
 */
export function capsFor(amounts: readonly string[], delta: bigint, decimalPlaces: number, exclude?: number): bigint[] {
  return amounts.map((a, i) => {
    if (i === exclude) return 0n;
    if (delta > 0n) return delta;
    const room = toMinor(a, decimalPlaces) - 1n;
    return room > 0n ? room : 0n;
  });
}

/** A slider position 0..1 as minor units of `cap`. The rounding is the gesture's, not money's. */
export function positionToMinor(position: number, cap: bigint): bigint {
  const clamped = Math.min(1, Math.max(0, position));
  if (cap <= 0n) return 0n;
  // cap fits a double for any real amount (2^53 minor units is ~90 trillion at 2 decimals).
  return BigInt(Math.round(Number(cap) * clamped));
}

export function minorToPosition(value: bigint, cap: bigint): number {
  if (cap <= 0n) return 0;
  return Number(value) / Number(cap);
}
