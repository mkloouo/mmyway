import { denominationsFor, totalDenominations } from './denominations';

describe('denominationsFor', () => {
  it('returns a ladder for a known currency', () => {
    const pln = denominationsFor('PLN');
    expect(pln).not.toBeNull();
    expect(pln!.map((d) => d.value)).toContain('100.00');
  });

  it('is case-insensitive', () => {
    expect(denominationsFor('pln')).toEqual(denominationsFor('PLN'));
  });

  it('returns null for an unknown currency', () => {
    expect(denominationsFor('XYZ')).toBeNull();
  });
});

describe('totalDenominations', () => {
  it('totals a mixed pile of PLN notes and coins exactly', () => {
    const ladder = denominationsFor('PLN')!;
    // 1×200 + 2×100 + 1×50 + 3×0,50 + 4×0,10 = 200 + 200 + 50 + 1.50 + 0.40 = 451.90
    const total = totalDenominations(
      { '200.00': 1, '100.00': 2, '50.00': 1, '0.50': 3, '0.10': 4 },
      ladder,
    );
    expect(total).toBe('451.90');
  });

  it('is 0 for no counts', () => {
    expect(totalDenominations({}, denominationsFor('PLN')!)).toBe('0');
  });

  it('ignores denominations not in the ladder', () => {
    const ladder = denominationsFor('USD')!;
    const total = totalDenominations({ '100.00': 1, '999.00': 5 }, ladder);
    expect(total).toBe('100.00');
  });
});

describe('more currencies', () => {
  it('has ladders beyond PLN/EUR/USD/UAH, whole yen without a fraction', () => {
    expect(denominationsFor('GBP')?.[0]).toEqual({ value: '50.00', label: '50' });
    expect(denominationsFor('JPY')?.at(-1)).toEqual({ value: '1', label: '1' });
    expect(totalDenominations({ '1000': 2, '5': 1 }, denominationsFor('JPY')!)).toBe('2005');
  });
});
