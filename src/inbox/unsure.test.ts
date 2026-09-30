import type { Draft } from './draft';
import { unsureAfter, unsureFields } from './unsure';

const draft: Draft = {
  type: 'withdrawal',
  amount: '42.50',
  currencyCode: 'PLN',
  date: '2026-09-15T10:00:00.000Z',
  description: 'Żabka',
  destinationName: 'Żabka',
  isNewPayee: true,
  lowConfidenceFields: ['amount', 'payee', 'date'],
};

describe('unsure fields', () => {
  it('lists what the reader was unsure of, skipping names it does not know', () => {
    expect(unsureFields(draft)).toEqual(['amount', 'payee', 'date']);
    expect(unsureFields({ lowConfidenceFields: ['date', 'merchant'] })).toEqual(['date']);
    expect(unsureFields({})).toEqual([]);
  });

  it('stops marking a field once the user sets it', () => {
    expect(unsureAfter(draft, { amount: '41.50' })).toEqual(['payee', 'date']);
    expect(unsureAfter(draft, { destinationName: 'Biedronka' })).toEqual(['amount', 'date']);
    expect(unsureAfter(draft, { categoryName: 'Groceries' })).toEqual(['amount', 'payee', 'date']);
  });

  it("treats an income's payer, not its account, as the payee", () => {
    const income: Draft = { ...draft, type: 'deposit', lowConfidenceFields: ['payee'] };
    expect(unsureAfter(income, { destinationName: 'Revolut' })).toEqual(['payee']);
    expect(unsureAfter(income, { sourceName: 'Employer' })).toBeUndefined();
  });

  it('leaves no empty list behind', () => {
    const one: Draft = { ...draft, lowConfidenceFields: ['date'] };
    expect(unsureAfter(one, { date: '2026-09-14T10:00:00.000Z' })).toBeUndefined();
    expect(
      unsureAfter({ ...draft, lowConfidenceFields: undefined }, { amount: '1' }),
    ).toBeUndefined();
  });
});
