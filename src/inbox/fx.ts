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

/**
 * The account whose currency FF3 books `amount` in: the one the money leaves, or the one it lands
 * in for an income. Not `accountLegCurrency`, which deliberately answers with a transfer's *other*
 * leg — the one the conversion is asked about.
 */
export function bookingLegAccountId(draft: Draft): string | undefined {
  return draft.type === 'deposit' ? draft.destinationId : draft.sourceId;
}

interface MoneyPair {
  amount: string;
  currencyCode: string;
  foreignAmount?: string;
  foreignCurrencyCode?: string;
}

/**
 * The two figures the right way round for FF3, which books `amount` in the asset leg's own
 * currency and ignores a `currency_code` that says otherwise — so a 15 EUR receipt paid from a
 * PLN account, sent as "15 EUR", was booked as 15 PLN.
 *
 * Which way round a draft arrives in depends on where it came from: Capture already stores what
 * the account was charged as the amount, while a receipt (and anything the draft screen's
 * "Account charged" row fills in) stores what was read, with the charge as the foreign side. So
 * this doesn't flip, it *orients*: whichever side is in the booking currency becomes the amount.
 * A pair with no foreign side, or with neither side in the booking currency, is left alone.
 */
export function orientForBooking(
  pair: MoneyPair,
  bookingCurrencyCode: string | undefined,
): MoneyPair {
  if (!pair.foreignAmount || !pair.foreignCurrencyCode || !bookingCurrencyCode) return pair;
  if (pair.currencyCode === bookingCurrencyCode) return pair;
  if (pair.foreignCurrencyCode !== bookingCurrencyCode) return pair;
  return {
    amount: pair.foreignAmount,
    currencyCode: pair.foreignCurrencyCode,
    foreignAmount: pair.amount,
    foreignCurrencyCode: pair.currencyCode,
  };
}
