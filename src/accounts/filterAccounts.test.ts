import { filterAccounts } from './filterAccounts';

const accounts = [
  { name: 'Revolut' },
  { name: 'Cash · Case · PLN' },
  { name: 'Żabka' },
  { name: 'Cash · Base' },
  { name: 'PKO Cash' },
];

describe('filterAccounts', () => {
  it('returns everything for an empty query', () => {
    expect(filterAccounts(accounts, '  ')).toBe(accounts);
  });
  it('folds diacritics and case', () => {
    expect(filterAccounts(accounts, 'zab').map((a) => a.name)).toEqual(['Żabka']);
  });
  it('ignores punctuation and spacing in account names', () => {
    expect(filterAccounts(accounts, 'cash case').map((a) => a.name)).toEqual(['Cash · Case · PLN']);
  });
  it('ranks prefix matches above substring matches', () => {
    expect(filterAccounts(accounts, 'cash').map((a) => a.name)).toEqual([
      'Cash · Case · PLN',
      'Cash · Base',
      'PKO Cash',
    ]);
  });
});
