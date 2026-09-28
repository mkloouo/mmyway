import { selectAssetAccounts, type ReferenceAccountRow } from './useAssetAccounts';

function row(id: string, name: string, type: string, active: boolean): ReferenceAccountRow {
  return {
    id,
    name,
    type,
    active,
    currencyCode: 'PLN',
    currentBalance: null,
    currentBalanceDate: null,
    notes: null,
    accountRole: null,
    includeNetWorth: true,
    openingBalance: null,
    openingBalanceDate: null,
    virtualBalance: null,
    creditCardType: null,
    monthlyPaymentDate: null,
    syncedAt: '',
  };
}

const rows = [
  row('1', 'Revolut', 'asset', true),
  row('2', 'Old bank', 'asset', false),
  row('3', 'Żabka', 'expense', true),
  row('4', 'Cash', 'asset', true),
];

describe('selectAssetAccounts', () => {
  it('keeps active asset accounts only, sorted by name', () => {
    expect(selectAssetAccounts(rows).map((a) => a.id)).toEqual(['4', '1']);
  });
  it('includes inactive ones on request', () => {
    expect(selectAssetAccounts(rows, { includeInactive: true }).map((a) => a.id)).toEqual([
      '4',
      '2',
      '1',
    ]);
  });
});

describe('FF3 account order', () => {
  it('sorts by FF3 order first, then name; unordered accounts go last', () => {
    expect(selectAssetAccounts(rows, { order: { '1': 1, '4': 2 } }).map((a) => a.id)).toEqual([
      '1',
      '4',
    ]);
    expect(
      selectAssetAccounts(rows, { includeInactive: true, order: { '2': 1 } }).map((a) => a.id),
    ).toEqual(['2', '4', '1']);
  });
});
