import { applyDigit } from './amountInput';

describe('applyDigit', () => {
  it('collapses leading zeros', () => {
    expect(applyDigit('0', '5', 2)).toBe('5');
    expect(applyDigit('0', '0', 2)).toBe('0');
    expect(applyDigit('0', '00', 2)).toBe('0');
  });

  it('builds a whole number digit by digit', () => {
    let v = '0';
    for (const key of ['2', '2', '4', '1'] as const) v = applyDigit(v, key, 2);
    expect(v).toBe('2241');
  });

  it('the 00 key appends two zeros once a non-zero digit exists', () => {
    expect(applyDigit('1', '00', 2)).toBe('100');
  });

  it('accepts only one decimal separator, comma or dot', () => {
    expect(applyDigit('12', ',', 2)).toBe('12.');
    expect(applyDigit('12.', '.', 2)).toBe('12.');
    expect(applyDigit('12.', ',', 2)).toBe('12.');
  });

  it('caps the fraction at the currency scale', () => {
    let v = applyDigit('12.', '4', 2);
    v = applyDigit(v, '1', 2);
    expect(v).toBe('12.41');
    expect(applyDigit(v, '9', 2)).toBe('12.41'); // no room left
  });

  it('rejects a decimal separator on a zero-decimal currency', () => {
    expect(applyDigit('1500', ',', 0)).toBe('1500');
  });

  it('backspace removes the last character and floors at "0", never below', () => {
    expect(applyDigit('22.4', '⌫', 2)).toBe('22.');
    expect(applyDigit('2', '⌫', 2)).toBe('0');
    expect(applyDigit('0', '⌫', 2)).toBe('0');
    expect(applyDigit('', '⌫', 2)).toBe(''); // no-op on empty
  });

  it('a fresh double-zero on an untouched amount stays at "0"', () => {
    expect(applyDigit('0', '00', 2)).toBe('0');
  });
});
