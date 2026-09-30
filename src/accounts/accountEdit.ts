// The account page's edit (app/accounts/[id].tsx): which fields changed, and how they are sent to
// FF3. Keys are reference_accounts column names, so the same object patches the local row.
import type { ReferenceAccountRow } from './useAssetAccounts';

export const ACCOUNT_ROLES = [
  'defaultAsset',
  'sharedAsset',
  'savingAsset',
  'ccAsset',
  'cashWalletAsset',
] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** FF3 has one credit-card type; it is required with the ccAsset role. */
export const CREDIT_CARD_TYPE = 'monthlyFull';

export interface AccountEdit {
  name?: string;
  currencyCode?: string;
  accountRole?: AccountRole;
  includeNetWorth?: boolean;
  openingBalance?: string | null;
  openingBalanceDate?: string | null;
  virtualBalance?: string | null;
  creditCardType?: string | null;
  monthlyPaymentDate?: string | null;
  /** The whole notes text, cash-envelope marker line included (see envelopeMarker.ts). */
  notes?: string | null;
}

/** The notes are edited as a description apart from the form (the marker line isn't the user's). */
export type AccountForm = Required<Omit<AccountEdit, 'notes'>>;

const FF3_FIELDS: Record<keyof AccountEdit, string> = {
  name: 'name',
  currencyCode: 'currency_code',
  accountRole: 'account_role',
  includeNetWorth: 'include_net_worth',
  openingBalance: 'opening_balance',
  openingBalanceDate: 'opening_balance_date',
  virtualBalance: 'virtual_balance',
  creditCardType: 'credit_card_type',
  monthlyPaymentDate: 'monthly_payment_date',
  notes: 'notes',
};

export function formFromAccount(row: ReferenceAccountRow): AccountForm {
  return {
    name: row.name,
    currencyCode: row.currencyCode,
    accountRole: (ACCOUNT_ROLES as readonly string[]).includes(row.accountRole ?? '')
      ? (row.accountRole as AccountRole)
      : 'defaultAsset',
    includeNetWorth: row.includeNetWorth,
    openingBalance: row.openingBalance,
    openingBalanceDate: row.openingBalanceDate,
    virtualBalance: row.virtualBalance,
    creditCardType: row.creditCardType,
    monthlyPaymentDate: row.monthlyPaymentDate,
  };
}

/** A blank or zero amount is "none" — FF3 answers a missing balance as "0" or null alike. */
function amountKey(value: string | null): string {
  if (!value) return '';
  return /^-?0*\.?0*$/.test(value) ? '' : value;
}

/**
 * Only the fields that changed, plus what FF3 needs alongside them: the opening balance and its
 * date travel together, and the ccAsset role needs the card type and payment date.
 */
export function diffAccountEdit(before: AccountForm, after: AccountForm): AccountEdit {
  const edit: AccountEdit = {};
  if (after.name.trim() !== before.name) edit.name = after.name.trim();
  if (after.currencyCode !== before.currencyCode) edit.currencyCode = after.currencyCode;
  if (after.includeNetWorth !== before.includeNetWorth)
    edit.includeNetWorth = after.includeNetWorth;
  if (amountKey(after.virtualBalance) !== amountKey(before.virtualBalance))
    edit.virtualBalance = amountKey(after.virtualBalance) || null;
  const openingChanged =
    amountKey(after.openingBalance) !== amountKey(before.openingBalance) ||
    after.openingBalanceDate !== before.openingBalanceDate;
  if (openingChanged) {
    const amount = amountKey(after.openingBalance) || null;
    edit.openingBalance = amount;
    edit.openingBalanceDate = amount ? after.openingBalanceDate : null;
  }
  const isCard = after.accountRole === 'ccAsset';
  const cardChanged = after.monthlyPaymentDate !== before.monthlyPaymentDate;
  if (after.accountRole !== before.accountRole || (isCard && cardChanged)) {
    edit.accountRole = after.accountRole;
    if (isCard) {
      edit.creditCardType = CREDIT_CARD_TYPE;
      edit.monthlyPaymentDate = after.monthlyPaymentDate;
    } else if (before.accountRole === 'ccAsset') {
      edit.creditCardType = null;
      edit.monthlyPaymentDate = null;
    }
  }
  return edit;
}

/** Why the form can't be saved yet, or null. */
export function accountFormProblem(
  form: AccountForm,
): 'name' | 'openingBalanceDate' | 'monthlyPaymentDate' | null {
  if (!form.name.trim()) return 'name';
  if (amountKey(form.openingBalance) && !form.openingBalanceDate) return 'openingBalanceDate';
  if (form.accountRole === 'ccAsset' && !form.monthlyPaymentDate) return 'monthlyPaymentDate';
  return null;
}

/** The FF3 `PUT /v1/accounts/{id}` body for an edit. */
export function ff3AccountBody(edit: AccountEdit): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(edit) as [keyof AccountEdit, unknown][]) {
    if (value !== undefined) body[FF3_FIELDS[key]] = value;
  }
  return body;
}
