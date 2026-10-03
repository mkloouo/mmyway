import {
  accountLegCurrency,
  bookingLegAccountId,
  draftAccountCurrency,
  needsForeignAmount,
  orientForBooking,
} from './fx';
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

describe('orientForBooking', () => {
  // A 15 EUR receipt paid from a PLN account that was charged 68.63.
  const read = {
    amount: '15.00',
    currencyCode: 'EUR',
    foreignAmount: '68.63',
    foreignCurrencyCode: 'PLN',
  };
  // The same entry as Capture stores it: the charge first.
  const typed = {
    amount: '68.63',
    currencyCode: 'PLN',
    foreignAmount: '15.00',
    foreignCurrencyCode: 'EUR',
  };

  it('puts the booking currency first, whichever side it arrived on', () => {
    expect(orientForBooking(read, 'PLN')).toEqual(typed);
    expect(orientForBooking(typed, 'PLN')).toEqual(typed);
  });

  it('leaves an entry with no foreign side alone', () => {
    const plain = { amount: '30.00', currencyCode: 'PLN' };
    expect(orientForBooking(plain, 'PLN')).toEqual(plain);
    expect(orientForBooking({ ...plain, foreignCurrencyCode: 'EUR' }, 'PLN')).toEqual({
      ...plain,
      foreignCurrencyCode: 'EUR',
    });
  });

  it('leaves it alone when the account is unknown, or neither side is its currency', () => {
    expect(orientForBooking(read, undefined)).toEqual(read);
    expect(orientForBooking(read, 'USD')).toEqual(read);
  });

  it('a transfer typed in the source currency keeps that side as the amount', () => {
    // 430 PLN out of the PLN account, 100 EUR into the EUR one: FF3 books the source leg.
    const transfer = {
      amount: '430.00',
      currencyCode: 'PLN',
      foreignAmount: '100.00',
      foreignCurrencyCode: 'EUR',
    };
    expect(orientForBooking(transfer, 'PLN')).toEqual(transfer);
  });
});

describe('bookingLegAccountId', () => {
  const base = { amount: '1', currencyCode: 'PLN', date: '', description: '', isNewPayee: false };
  it('is the account the money leaves, or lands in for an income', () => {
    expect(
      bookingLegAccountId({ ...base, type: 'withdrawal', sourceId: 'a', destinationId: 'b' }),
    ).toBe('a');
    expect(
      bookingLegAccountId({ ...base, type: 'deposit', sourceId: 'a', destinationId: 'b' }),
    ).toBe('b');
    expect(
      bookingLegAccountId({ ...base, type: 'transfer', sourceId: 'a', destinationId: 'b' }),
    ).toBe('a');
  });
});
