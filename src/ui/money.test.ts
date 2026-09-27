import { formatMoney, signFor } from './money';

const PLN = { symbol: 'zł', decimalPlaces: 2 };
const JPY = { symbol: '¥', decimalPlaces: 0 };

describe('formatMoney', () => {
  it('pads to the currency scale and groups thousands', () => {
    expect(formatMoney('1234.5', PLN)).toBe('1 234,50 zł');
    expect(formatMoney('22.41', PLN)).toBe('22,41 zł');
    expect(formatMoney('9000', PLN)).toBe('9 000,00 zł');
    expect(formatMoney('1234567.89', PLN)).toBe('1 234 567,89 zł');
  });

  it('renders a zero-decimal currency without a fraction', () => {
    expect(formatMoney('1500', JPY)).toBe('1 500 ¥');
  });

  it('keeps a negative sign and an over-long fraction rather than rounding it away', () => {
    expect(formatMoney('-41.91', PLN)).toBe('−41,91 zł');
    expect(formatMoney('0.12345', PLN)).toBe('0,12345 zł');
  });

  it('survives empty and malformed input', () => {
    expect(formatMoney('', PLN)).toBe('0,00 zł');
    expect(formatMoney('.5', PLN)).toBe('0,50 zł');
  });
});

describe('signFor', () => {
  it('marks income, leaves spending neutral and transfers unsigned', () => {
    expect(signFor('deposit')).toBe('+');
    expect(signFor('withdrawal')).toBe('−');
    expect(signFor('transfer')).toBe('');
  });
});
