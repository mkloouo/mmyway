import {
  absorb,
  applyShares,
  balance,
  capsFor,
  defaultShares,
  fromMinor,
  leftover,
  positionToMinor,
  sumMinor,
  toMinor,
} from './allocate';

describe('minor units', () => {
  it('round-trips decimal strings', () => {
    expect(toMinor('12.5', 2)).toBe(1250n);
    expect(toMinor('12.000000000000', 2)).toBe(1200n);
    expect(toMinor('-3.07', 2)).toBe(-307n);
    expect(toMinor('7', 0)).toBe(7n);
    expect(fromMinor(1250n, 2)).toBe('12.50');
    expect(fromMinor(5n, 2)).toBe('0.05');
    expect(fromMinor(-307n, 2)).toBe('-3.07');
    expect(fromMinor(7n, 0)).toBe('7');
  });

  it('sums and finds the leftover', () => {
    expect(sumMinor(['10.00', '2.5'], 2)).toBe(1250n);
    expect(leftover('20', ['10.00', '2.5'], 2)).toBe(750n);
    expect(leftover('10', ['10.00', '2.5'], 2)).toBe(-250n);
  });
});

describe('defaultShares', () => {
  it('takes from the first slot first', () => {
    expect(defaultShares(300n, [1000n, 500n])).toEqual([300n, 0n]);
    expect(defaultShares(1200n, [1000n, 500n])).toEqual([1000n, 200n]);
  });

  it('is null when the caps cannot hold the target', () => {
    expect(defaultShares(2000n, [1000n, 500n])).toBeNull();
  });
});

describe('balance', () => {
  it('keeps the sum at the target when a slider moves', () => {
    const next = balance([300n, 0n], [999n, 499n], 300n, 1, 200n);
    expect(next).toEqual([100n, 200n]);
    expect(next.reduce((a, b) => a + b, 0n)).toBe(300n);
  });

  it('gives back to the others when a slider moves down', () => {
    expect(balance([100n, 200n], [999n, 499n], 300n, 1, 50n)).toEqual([250n, 50n]);
  });

  it('holds the moved slider back when the others cannot absorb it', () => {
    // Slot 1 asks for 0, but slot 0 can hold at most 200 of the 300.
    expect(balance([200n, 100n], [200n, 499n], 300n, 1, 0n)).toEqual([200n, 100n]);
  });

  it('clamps to the cap and the target', () => {
    expect(balance([300n, 0n], [999n, 499n], 300n, 1, 10_000n)).toEqual([0n, 300n]);
  });
});

describe('capsFor and applyShares', () => {
  it('leaves each split at least one minor unit when taking', () => {
    expect(capsFor(['10.00', '0.01'], -500n, 2)).toEqual([999n, 0n]);
  });

  it('caps each split at the delta when adding, except the excluded one', () => {
    expect(capsFor(['10.00', '5.00', '1.00'], 250n, 2, 1)).toEqual([250n, 0n, 250n]);
  });

  it('applies shares with a sign', () => {
    expect(applyShares(['10.00', '5.00'], [300n, 0n], -1, 2)).toEqual(['7.00', '5.00']);
    expect(applyShares(['10.00', '5.00'], [0n, 250n], 1, 2)).toEqual(['10.00', '7.50']);
  });
});

it('maps a slider position to minor units', () => {
  expect(positionToMinor(0.5, 1000n)).toBe(500n);
  expect(positionToMinor(2, 1000n)).toBe(1000n);
  expect(positionToMinor(0.3, 0n)).toBe(0n);
});

describe('absorb', () => {
  it('lets split 1 take the difference', () => {
    expect(absorb(['70.00', '30.00'], 500n, 2)).toEqual(['75.00', '30.00']);
    expect(absorb(['70.00', '30.00'], -500n, 2)).toEqual(['65.00', '30.00']);
  });

  it('uses split 2 when split 1 was the one typed', () => {
    expect(absorb(['80.00', '30.00'], -1000n, 2, 0)).toEqual(['80.00', '20.00']);
  });

  it('is null when the absorbing split would reach zero', () => {
    expect(absorb(['5.00', '30.00'], -500n, 2)).toBeNull();
  });
});
