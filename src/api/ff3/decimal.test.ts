import { addDecimal, isNegative, divideDecimal, parseDecimalInput, parseSignedDecimalInput } from './decimal';

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

describe('parseDecimalInput', () => {
  it.each([
    ['12,50', '12.50'], ['12.5', '12.5'], ['1 234,5', '1234.5'], ['1 234,50', '1234.50'],
    ['12,', '12'], [',5', '0.5'], ['007', '7'], ['0', '0'],
  ])('accepts %p as %p', (raw, value) => {
    expect(parseDecimalInput(raw)).toEqual({ ok: true, value });
  });
  it.each(['', ' ', ',', '.'])('reports %p as empty', (raw) => {
    expect(parseDecimalInput(raw)).toEqual({ ok: false, reason: 'empty' });
  });
  it.each(['12,5,0', '1.2.3', '-5', '12a', '1e5', '12.50 zł'])('rejects %p', (raw) => {
    expect(parseDecimalInput(raw)).toEqual({ ok: false, reason: 'invalid' });
  });
  it('enforces the currency scale when given one', () => {
    expect(parseDecimalInput('1.234', 2)).toEqual({ ok: false, reason: 'too_many_decimals' });
    expect(parseDecimalInput('1.23', 2)).toEqual({ ok: true, value: '1.23' });
  });
  it('output always survives the arithmetic helpers', () => {
    const parsed = parseDecimalInput('1 234,5');
    expect(parsed.ok && addDecimal(parsed.value, '0.5')).toBe('1235.0');
  });
});

describe('parseSignedDecimalInput', () => {
  it('accepts a leading minus (either dash) and keeps parseDecimalInput rules', () => {
    expect(parseSignedDecimalInput('-12,50')).toEqual({ ok: true, value: '-12.50' });
    expect(parseSignedDecimalInput('−3')).toEqual({ ok: true, value: '-3' });
    expect(parseSignedDecimalInput('-0')).toEqual({ ok: true, value: '0' });
    expect(parseSignedDecimalInput('12')).toEqual({ ok: true, value: '12' });
    expect(parseSignedDecimalInput('--1').ok).toBe(false);
  });
});
