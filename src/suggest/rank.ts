import { normkey } from '../lookup/normkey';
import type { MerchantHistory } from '../lookup/merchantLookup';

export interface RankedCandidate {
  merchantKey: string;
  displayName: string;
  score: number;
}

export function rankCandidates(histories: MerchantHistory[], partial: { merchantQuery?: string } = {}): RankedCandidate[] {
  const query = partial.merchantQuery ? normkey(partial.merchantQuery) : '';
  return histories
    .map((history) => {
      let score = history.occurrences;
      if (query && history.merchantKey.startsWith(query)) score += 100;
      else if (query && history.merchantKey.includes(query)) score += 50;
      else if (query) score = 0; // no match at all when a query is given and nothing lines up
      return { merchantKey: history.merchantKey, displayName: history.displayName, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
}
