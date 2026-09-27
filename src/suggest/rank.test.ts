import { rankCandidates } from './rank';
import type { MerchantHistory } from '../lookup/merchantLookup';

const histories: MerchantHistory[] = [
  { merchantKey: 'zabka', displayName: 'Żabka', topCategory: 'Groceries', topAccountName: 'Cash', topBudgetName: null, occurrences: 20 },
  { merchantKey: 'zara', displayName: 'Zara', topCategory: 'Clothes', topAccountName: 'Revolut', topBudgetName: null, occurrences: 3 },
];

describe('rankCandidates', () => {
  it('ranks by frequency with no query', () => {
    const result = rankCandidates(histories);
    expect(result[0]?.merchantKey).toBe('zabka');
  });

  it('boosts a prefix match over a plain substring match', () => {
    const result = rankCandidates(histories, { merchantQuery: 'za' });
    expect(result.map((c) => c.merchantKey)).toEqual(['zabka', 'zara']);
  });

  it('excludes candidates that do not match a given query at all', () => {
    const result = rankCandidates(histories, { merchantQuery: 'mcdonalds' });
    expect(result).toHaveLength(0);
  });
});
