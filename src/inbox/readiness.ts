// Whether a draft has everything `confirmInboxItem` needs to become a transaction (design §6.1,
// §6.2's Save & ✓, and Confirm all's filter). Pure — no db access — so every screen and test uses
// the same rule.
import type { Draft } from './draft';
import { needsForeignAmount } from './fx';
import { leftover } from '../splits/allocate';

export interface DraftReadiness {
  ready: boolean;
  missing: string[];
}

function isBlank(value: string | undefined | null): boolean {
  return !value || value.trim() === '';
}

function isZeroAmount(amount: string): boolean {
  return /^-?0*\.?0*$/.test(amount.trim());
}

/**
 * `accountCurrencyCode` is the currency of the asset leg the money moves through
 * (`src/inbox/fx.ts`'s `accountLegCurrency`), when the caller knows it. Without it the converted
 * amount can't be judged, so a caller that doesn't read accounts leaves it out.
 */
export function draftReadiness(draft: Draft, accountCurrencyCode?: string | null): DraftReadiness {
  const missing: string[] = [];

  if (isZeroAmount(draft.amount)) missing.push('amount');
  if (isBlank(draft.currencyCode)) missing.push('currency');
  // FF3 books the transaction in the account's currency: without the converted figure the number
  // read off the receipt would be booked as if the account had been charged it (#105). Only for a
  // plain entry — a split group needs one converted amount per split (#129).
  if (
    needsForeignAmount(accountCurrencyCode, draft.currencyCode) &&
    (draft.extraSplits ?? []).length === 0 &&
    (isBlank(draft.foreignAmount) || isZeroAmount(draft.foreignAmount ?? ''))
  ) {
    missing.push('converted amount');
  }

  if (draft.type === 'withdrawal' || draft.type === 'transfer') {
    if (isBlank(draft.sourceId) && isBlank(draft.sourceName)) missing.push('source account');
  }
  if (draft.type === 'deposit' || draft.type === 'transfer') {
    if (isBlank(draft.destinationId) && isBlank(draft.destinationName))
      missing.push('destination account');
  }
  if (draft.type === 'withdrawal') {
    if (isBlank(draft.destinationName) && isBlank(draft.destinationId)) missing.push('payee');
  }
  if (draft.type === 'deposit') {
    if (isBlank(draft.sourceName) && isBlank(draft.sourceId)) missing.push('payee');
  }

  const extras = draft.extraSplits ?? [];
  if (extras.length > 0) {
    if (extras.some((s) => isZeroAmount(s.amount))) missing.push('split amount');
    if (draft.type !== 'transfer' && extras.some((s) => isBlank(s.payeeName) && isBlank(s.payeeId)))
      missing.push('split payee');
    // The splits must add up to the total the user tracks (src/splits/allocate.ts's leftover).
    if (
      draft.total !== undefined &&
      leftover(draft.total, [draft.amount, ...extras.map((s) => s.amount)], 12) !== 0n
    ) {
      missing.push('split total');
    }
  }

  return { ready: missing.length === 0, missing };
}
