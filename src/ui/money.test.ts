import {
  formatMoney,
  formatAmountInput,
  signFor,
  currencyOf,
  type NumberSeparators,
} from './money';

// The phone's number format is passed explicitly so these don't depend on the test machine's.
const PL: NumberSeparators = { group: '\u202F', decimal: ',' };
const US: NumberSeparators = { group: ',', decimal: '.' };

const PLN = { symbol: 'zł', decimalPlaces: 2 };
const JPY = { symbol: '¥', decimalPlaces: 0 };

describe('formatMoney', () => {
  it('pads to the currency scale and groups thousands', () => {
    expect(formatMoney('1234.5', PLN, PL)).toBe('1 234,50 zł');
    expect(formatMoney('22.41', PLN, PL)).toBe('22,41 zł');
    expect(formatMoney('9000', PLN, PL)).toBe('9 000,00 zł');
    expect(formatMoney('1234567.89', PLN, PL)).toBe('1 234 567,89 zł');
  });

  it('renders a zero-decimal currency without a fraction', () => {
    expect(formatMoney('1500', JPY, PL)).toBe('1 500 ¥');
  });

  it('keeps a negative sign and an over-long fraction rather than rounding it away', () => {
    expect(formatMoney('-41.91', PLN, PL)).toBe('−41,91 zł');
    expect(formatMoney('0.12345', PLN, PL)).toBe('0,12345 zł');
  });

  it('survives empty and malformed input', () => {
    expect(formatMoney('', PLN, PL)).toBe('0,00 zł');
    expect(formatMoney('.5', PLN, PL)).toBe('0,50 zł');
  });

  it('keeps non-zero fraction longer then a currency scale', () => {
    expect(formatMoney('12.000000000', PLN, PL)).toBe('12,00 zł');
    expect(formatMoney('12.000000040', PLN, PL)).toBe('12,00000004 zł');
  });
});

describe('formatAmountInput', () => {
  it('echoes the keypad string instead of padding it to the currency scale', () => {
    expect(formatAmountInput('0', PLN, PL)).toBe('0 zł');
    expect(formatAmountInput('123', PLN, PL)).toBe('123 zł');
    expect(formatAmountInput('123.', PLN, PL)).toBe('123, zł');
    expect(formatAmountInput('123.0', PLN, PL)).toBe('123,0 zł');
    expect(formatAmountInput('123.05', PLN, PL)).toBe('123,05 zł');
    expect(formatAmountInput('1234567', PLN, PL)).toBe('1 234 567 zł');
  });
});

describe('signFor', () => {
  it('marks income, leaves spending neutral and transfers unsigned', () => {
    expect(signFor('deposit')).toBe('+');
    expect(signFor('withdrawal')).toBe('−');
    expect(signFor('transfer')).toBe('');
  });
});

describe('currencyOf', () => {
  const currencies = [
    { code: 'PLN', symbol: 'zł', decimalPlaces: 2 },
    { code: 'JPY', symbol: '¥', decimalPlaces: 0 },
  ];

  it('finds a synced currency by code', () => {
    expect(currencyOf(currencies, 'JPY')).toEqual({ symbol: '¥', decimalPlaces: 0 });
  });

  it('falls back to the code itself with 2 decimal places when unsynced', () => {
    expect(currencyOf(currencies, 'USD')).toEqual({ symbol: 'USD', decimalPlaces: 2 });
  });
});

describe('number format', () => {
  it("follows the phone's separators", () => {
    expect(formatMoney('1234.5', { symbol: 'zł', decimalPlaces: 2 }, US)).toBe('1,234.50 zł');
    expect(formatAmountInput('1234.5', { symbol: '$', decimalPlaces: 2 }, US)).toBe('1,234.5 $');
  });
});
