// Turns the capture screen's local state into what `createManualEntry` accepts — pure, so
// "Save & ✓" and "Save to inbox" (design §6.2 step 9) build the payload identically and the
// three type branches (§6.2 step 11) are testable without mounting the screen.
import type { ManualEntryInput } from '../inbox/createManualEntry';
import type { Draft } from '../inbox/draft';

export interface CaptureFormState {
  type: Draft['type'];
  amount: string;
  currencyCode: string;
  date: Date;
  description: string;
  merchantRawInput: string;
  forceNewPayee: boolean;
  sourceId: string | null;
  destinationId: string | null;
  categoryName: string | null;
  budgetId: string | null;
  notes: string;
  sharedWith: string;
  foreignAmount: string;
  foreignCurrencyCode: string | null;
}

export function buildManualEntryInput(
  state: CaptureFormState,
  accounts: { id: string; name: string }[],
): ManualEntryInput {
  const needsPayee = state.type === 'withdrawal' || state.type === 'deposit';
  const needsSource = state.type === 'withdrawal' || state.type === 'transfer';
  const needsDestination = state.type === 'deposit' || state.type === 'transfer';
  const sourceAccount = accounts.find((a) => a.id === state.sourceId);
  const destinationAccount = accounts.find((a) => a.id === state.destinationId);

  // The keypad can leave a bare trailing separator ("12."), which the capture screen now
  // echoes back as the user types — FF3 must not see it.
  const typedAmount = state.amount.replace(/\.$/, '');
  // FX: the screen's `foreignAmount` is what the account's own currency moved (the "converts to
  // ___ EUR" field), `foreignCurrencyCode` that account's currency. FF3 books `amount` in the
  // account's currency and ignores a mismatched currency_code, so sending the typed amount as
  // `amount` booked "123.12 PLN, 1000 EUR" as 123.12 EUR. The account-currency figure is the
  // amount; what was typed is the foreign side.
  const fx =
    state.foreignAmount && state.foreignCurrencyCode
      ? {
          amount: state.foreignAmount,
          currencyCode: state.foreignCurrencyCode,
          foreignAmount: typedAmount,
          foreignCurrencyCode: state.currencyCode,
        }
      : null;

  return {
    type: state.type,
    amount: fx ? fx.amount : typedAmount,
    currencyCode: fx ? fx.currencyCode : state.currencyCode,
    date: state.date.toISOString(),
    description:
      state.description ||
      state.merchantRawInput ||
      (state.type === 'transfer' && sourceAccount && destinationAccount
        ? // A transfer has no payee: "transfer" on every one of them said nothing in a list.
          `${sourceAccount.name} → ${destinationAccount.name}`
        : state.type),
    merchantRawInput: needsPayee ? state.merchantRawInput : undefined,
    forceNewPayee: needsPayee ? state.forceNewPayee : undefined,
    sourceId: needsSource ? (state.sourceId ?? undefined) : undefined,
    sourceName: needsSource ? sourceAccount?.name : undefined,
    destinationId: needsDestination ? (state.destinationId ?? undefined) : undefined,
    destinationName: needsDestination ? destinationAccount?.name : undefined,
    categoryName: state.categoryName ?? undefined,
    budgetId: state.budgetId ?? undefined,
    notes: state.notes || undefined,
    foreignAmount: fx?.foreignAmount,
    foreignCurrencyCode: fx?.foreignCurrencyCode,
    sharedWith: state.sharedWith || undefined,
  };
}
