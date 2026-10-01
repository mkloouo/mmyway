import { accountLegCurrency, draftAccountCurrency, needsForeignAmount } from './fx';
import type { Draft } from './draft';

describe('accountLegCurrency', () => {
  it('a withdrawal is booked in the source account currency', () => {
    expect(accountLegCurrency('withdrawal', 'EUR', 'PLN', undefined)).toBe('PLN');
  });

  it('a deposit is booked in the destination account currency', () => {
    expect(accountLegCurrency('deposit', 'EUR', undefined, 'PLN')).toBe('PLN');
  });

  it('a transfer takes the leg that does not already match the entry', () => {
    expect(accountLegCurrency('transfer', 'PLN', 'PLN', 'EUR')).toBe('EUR');
    expect(accountLegCurrency('transfer', 'EUR', 'PLN', 'EUR')).toBe('PLN');
  });

  it('is undefined while the account is unknown', () => {
    expect(accountLegCurrency('withdrawal', 'EUR', undefined, undefined)).toBeUndefined();
  });
});

describe('needsForeignAmount', () => {
  it('only when both currencies are known and differ', () => {
    expect(needsForeignAmount('PLN', 'EUR')).toBe(true);
    expect(needsForeignAmount('PLN', 'PLN')).toBe(false);
    expect(needsForeignAmount(undefined, 'EUR')).toBe(false);
    expect(needsForeignAmount('PLN', '')).toBe(false);
  });
});

describe('draftAccountCurrency', () => {
  const currencies: Record<string, string> = { 'acc-pln': 'PLN', 'acc-eur': 'EUR' };
  const lookup = (id: string | undefined) => (id ? currencies[id] : undefined);

  it('reads the leg the draft points at', () => {
    const draft: Draft = {
      type: 'withdrawal',
      amount: '10.00',
      currencyCode: 'EUR',
      date: '2026-09-27T00:00:00.000Z',
      description: 'Lidl',
      isNewPayee: false,
      sourceId: 'acc-pln',
      destinationName: 'Lidl',
    };
    expect(draftAccountCurrency(draft, lookup)).toBe('PLN');
  });
});
