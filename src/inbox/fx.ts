// Firefly III books a transaction in the account leg's own currency, so an entry read or typed in
// another currency has to carry what the account was actually charged as `foreign_amount`
// (design §6.2). Capture, the draft screen and the Inbox's Confirm all ask the same question
// through here instead of each deciding for itself.
import type { Draft } from './draft';

/**
 * The currency of the asset leg the money leaves or lands in, or undefined while that account
 * isn't chosen yet.
 */
export function accountLegCurrency(
  type: Draft['type'],
  entryCurrencyCode: string | null | undefined,
  sourceCurrencyCode: string | null | undefined,
  destinationCurrencyCode: string | null | undefined,
): string | undefined {
  if (type === 'deposit') return destinationCurrencyCode ?? undefined;
  // A transfer has two asset legs: the one that already matches the entry isn't the foreign one.
  if (type === 'transfer')
    return (
      (sourceCurrencyCode === entryCurrencyCode ? destinationCurrencyCode : sourceCurrencyCode) ??
      undefined
    );
  return sourceCurrencyCode ?? undefined;
}

/** Whether the converted amount has to be asked for: both currencies known and different. */
export function needsForeignAmount(
  accountCurrencyCode: string | null | undefined,
  entryCurrencyCode: string | null | undefined,
): boolean {
  return !!accountCurrencyCode && !!entryCurrencyCode && accountCurrencyCode !== entryCurrencyCode;
}

/** `accountLegCurrency` for a draft, given the asset accounts it points at. */
export function draftAccountCurrency(
  draft: Draft,
  currencyOfAccount: (id: string | undefined) => string | undefined,
): string | undefined {
  return accountLegCurrency(
    draft.type,
    draft.currencyCode,
    currencyOfAccount(draft.sourceId),
    currencyOfAccount(draft.destinationId),
  );
}
