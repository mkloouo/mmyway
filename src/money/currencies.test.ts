import { pickableCurrencies, primaryCurrencyCode } from './currencies';

const row = (code: string, enabled: boolean, isDefault = false) => ({
  code,
  symbol: code,
  decimalPlaces: 2,
  enabled,
  isDefault,
  syncedAt: 's',
});
const rows = [row('BTC', false), row('EUR', true), row('PLN', true, true), row('USD', false)];

describe('currency pickers', () => {
  it("offer only enabled currencies, FF3's primary first", () => {
    expect(pickableCurrencies(rows).map((c) => c.code)).toEqual(['PLN', 'EUR']);
  });
  it('keep a disabled currency that is already selected', () => {
    expect(pickableCurrencies(rows, 'USD').map((c) => c.code)).toEqual(['PLN', 'EUR', 'USD']);
  });
  it("know FF3's primary currency", () => {
    expect(primaryCurrencyCode(rows)).toBe('PLN');
    expect(primaryCurrencyCode([])).toBeNull();
  });
});
