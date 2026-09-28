import { normkey } from '../lookup/normkey';
import type { MerchantHistory } from '../lookup/merchantLookup';

export interface RankedCandidate {
  merchantKey: string;
  displayName: string;
  score: number;
}

/**
 * With no query: most recently used first (a payee from yesterday before one from last year,
 * however often that one was used), ties by frequency. With a query: prefix matches, then
 * substring matches, each most recent first.
 */
export function rankCandidates(
  histories: MerchantHistory[],
  partial: { merchantQuery?: string } = {},
): RankedCandidate[] {
  const query = partial.merchantQuery ? normkey(partial.merchantQuery) : '';
  return histories
    .map((history) => {
      const tier = !query
        ? 1
        : history.merchantKey.startsWith(query)
          ? 2
          : history.merchantKey.includes(query)
            ? 1
            : 0;
      return {
        merchantKey: history.merchantKey,
        displayName: history.displayName,
        score: tier,
        lastUsed: history.lastUsed ?? '',
        occurrences: history.occurrences,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.lastUsed < b.lastUsed ? 1 : a.lastUsed > b.lastUsed ? -1 : 0) ||
        b.occurrences - a.occurrences,
    )
    .map(({ merchantKey, displayName, score }) => ({ merchantKey, displayName, score }));
}
