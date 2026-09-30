import { conflictFields } from './conflictDiff';

const row = {
  groupId: 'g1',
  journalId: 'j1',
  type: 'withdrawal',
  date: '2026-09-27T10:00:00+02:00',
  amount: '15.000000000000',
  currencyCode: 'PLN',
  foreignAmount: null,
  foreignCurrencyCode: null,
  description: 'TEST 3.7',
  sourceName: 'Cash',
  destinationName: 'Żabka',
  categoryName: 'Groceries',
  budgetName: null,
  sourceId: null,
  destinationId: null,
  budgetId: null,
  splitCount: 1,
  splitsJson: null,
  searchKey: null,
  tagsJson: '["mmyway-reviewed"]',
  notes: 'set in the web UI',
  updatedAt: 'v2',
  syncedAt: 's',
};
const lookups = {
  accountName: (id: string) => (({ a1: 'Revolut' }) as Record<string, string>)[id],
  budgetName: () => undefined,
  money: (a: string) => `${Number(a).toFixed(2)} zł`,
};

describe('conflictFields', () => {
  it('pairs each queued field with the server value', () => {
    const fields = conflictFields(
      { notes: 'Become noted (1)', amount: '15.00', source_id: 'a1' },
      row,
      lookups,
    );
    expect(fields).toEqual([
      {
        label: 'Description',
        server: 'set in the web UI',
        mine: 'Become noted (1)',
        differs: true,
      },
      { label: 'Amount', server: '15.00 zł', mine: '15.00 zł', differs: false },
      { label: 'From', server: 'Cash', mine: 'Revolut', differs: true },
    ]);
  });
  it('shows an empty server value as a dash', () => {
    expect(conflictFields({ notes: 'x' }, { ...row, notes: null }, lookups)[0]).toMatchObject({
      server: '—',
      mine: 'x',
    });
  });
});
