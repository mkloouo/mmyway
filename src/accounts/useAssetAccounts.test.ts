import { selectAssetAccounts, type ReferenceAccountRow } from './useAssetAccounts';

function row(id: string, name: string, type: string, active: boolean): ReferenceAccountRow {
  return { id, name, type, active, currencyCode: 'PLN', currentBalance: null, currentBalanceDate: null, notes: null, syncedAt: '' };
}

const rows = [row('1', 'Revolut', 'asset', true), row('2', 'Old bank', 'asset', false), row('3', 'Żabka', 'expense', true), row('4', 'Cash', 'asset', true)];

describe('selectAssetAccounts', () => {
  it('keeps active asset accounts only, sorted by name', () => {
    expect(selectAssetAccounts(rows).map((a) => a.id)).toEqual(['4', '1']);
  });
  it('includes inactive ones on request', () => {
    expect(selectAssetAccounts(rows, { includeInactive: true }).map((a) => a.id)).toEqual(['4', '2', '1']);
  });
});
