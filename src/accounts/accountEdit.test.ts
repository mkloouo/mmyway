import {
  accountFormProblem,
  diffAccountEdit,
  ff3AccountBody,
  type AccountForm,
} from './accountEdit';

const base: AccountForm = {
  name: 'Revolut',
  currencyCode: 'PLN',
  accountRole: 'defaultAsset',
  includeNetWorth: true,
  openingBalance: '100.00',
  openingBalanceDate: '2026-01-01',
  virtualBalance: '0.00',
  creditCardType: null,
  monthlyPaymentDate: null,
};

describe('diffAccountEdit', () => {
  it('is empty when nothing changed, treating "0.00" and blank alike', () => {
    expect(diffAccountEdit(base, { ...base, virtualBalance: null })).toEqual({});
  });

  it('carries only the changed fields, name trimmed', () => {
    expect(
      diffAccountEdit(base, {
        ...base,
        name: ' Revolut EUR ',
        currencyCode: 'EUR',
        includeNetWorth: false,
      }),
    ).toEqual({ name: 'Revolut EUR', currencyCode: 'EUR', includeNetWorth: false });
  });

  it('sends the opening balance and its date together', () => {
    expect(diffAccountEdit(base, { ...base, openingBalanceDate: '2026-02-01' })).toEqual({
      openingBalance: '100.00',
      openingBalanceDate: '2026-02-01',
    });
    expect(diffAccountEdit(base, { ...base, openingBalance: null })).toEqual({
      openingBalance: null,
      openingBalanceDate: null,
    });
  });

  it('adds the card type and payment date for a credit card, and clears them after', () => {
    const card = diffAccountEdit(base, {
      ...base,
      accountRole: 'ccAsset',
      monthlyPaymentDate: '2026-10-15',
    });
    expect(card).toEqual({
      accountRole: 'ccAsset',
      creditCardType: 'monthlyFull',
      monthlyPaymentDate: '2026-10-15',
    });
    const cardForm = {
      ...base,
      accountRole: 'ccAsset' as const,
      creditCardType: 'monthlyFull',
      monthlyPaymentDate: '2026-10-15',
    };
    expect(diffAccountEdit(cardForm, { ...cardForm, accountRole: 'savingAsset' })).toEqual({
      accountRole: 'savingAsset',
      creditCardType: null,
      monthlyPaymentDate: null,
    });
  });
});

describe('accountFormProblem', () => {
  it('needs a name, an opening-balance date with an opening balance, and a payment date for a card', () => {
    expect(accountFormProblem(base)).toBeNull();
    expect(accountFormProblem({ ...base, name: '  ' })).toBe('name');
    expect(accountFormProblem({ ...base, openingBalanceDate: null })).toBe('openingBalanceDate');
    expect(
      accountFormProblem({ ...base, openingBalance: null, openingBalanceDate: null }),
    ).toBeNull();
    expect(accountFormProblem({ ...base, accountRole: 'ccAsset' })).toBe('monthlyPaymentDate');
  });
});

describe('ff3AccountBody', () => {
  it('maps to FF3 field names and leaves out undefined', () => {
    expect(
      ff3AccountBody({ accountRole: 'savingAsset', virtualBalance: null, name: undefined }),
    ).toEqual({ account_role: 'savingAsset', virtual_balance: null });
  });
});
