import { rankCandidates } from './rank';
import type { MerchantHistory } from '../lookup/merchantLookup';

const histories: MerchantHistory[] = [
  {
    merchantKey: 'zabka',
    displayName: 'Żabka',
    topCategory: 'Groceries',
    topAccountName: 'Cash',
    topBudgetName: null,
    occurrences: 20,
    lastUsed: '2026-06-01',
  },
  {
    merchantKey: 'zara',
    displayName: 'Zara',
    topCategory: 'Clothes',
    topAccountName: 'Revolut',
    topBudgetName: null,
    occurrences: 3,
    lastUsed: '2026-09-26',
  },
];

describe('rankCandidates', () => {
  it('ranks by most recent use with no query, not by frequency', () => {
    expect(rankCandidates(histories).map((c) => c.merchantKey)).toEqual(['zara', 'zabka']);
  });

  it('puts a prefix match above a substring match, even a more recent one', () => {
    const withBazar = [
      ...histories,
      {
        merchantKey: 'bazar',
        displayName: 'Bazar',
        topCategory: null,
        topAccountName: null,
        topBudgetName: null,
        occurrences: 9,
        lastUsed: '2026-09-27',
      },
    ];
    expect(rankCandidates(withBazar, { merchantQuery: 'za' }).map((c) => c.merchantKey)).toEqual([
      'zara',
      'zabka',
      'bazar',
    ]);
  });

  it('excludes candidates that do not match a given query at all', () => {
    const result = rankCandidates(histories, { merchantQuery: 'mcdonalds' });
    expect(result).toHaveLength(0);
  });
});
