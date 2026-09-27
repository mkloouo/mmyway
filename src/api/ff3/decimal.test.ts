import { addDecimal, isNegative, divideDecimal } from './decimal';

describe('addDecimal', () => {
  it('adds two decimals with matching scale', () => {
    expect(addDecimal('12.01', '3.99')).toBe('16.00');
  });
  it('adds decimals with different scale', () => {
    expect(addDecimal('12', '0.5')).toBe('12.5');
  });
  it('handles negatives', () => {
    expect(addDecimal('-5.00', '2.50')).toBe('-2.50');
  });
});

describe('isNegative', () => {
  it('detects a leading minus', () => {
    expect(isNegative('-1.00')).toBe(true);
    expect(isNegative('1.00')).toBe(false);
  });
});

describe('divideDecimal', () => {
  it('divides to the requested precision, truncating rather than rounding', () => {
    expect(divideDecimal('100.00', '21.40', 4)).toBe('4.6728');
  });

  it('handles a scale-2 over scale-2 divide', () => {
    expect(divideDecimal('21.40', '100.00', 4)).toBe('0.2140');
  });

  it('returns 0 for a zero or unparsed denominator rather than throwing', () => {
    expect(divideDecimal('10', '0', 2)).toBe('0');
    expect(divideDecimal('10', '', 2)).toBe('0');
  });

  it('matches exact integer division with no drift (0.1/0.1 style case)', () => {
    expect(divideDecimal('0.30', '0.10', 2)).toBe('3.00');
  });
});
