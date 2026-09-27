import { addDecimal, isNegative } from './decimal';

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
