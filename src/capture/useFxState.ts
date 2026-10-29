import { useEffect } from 'react';
import { LayoutAnimation } from 'react-native';
import { accountLegCurrency, needsForeignAmount } from '../inbox/fx';
import { parseDecimalInput, divideDecimal } from '../api/ff3/decimal';
import type { AccountPickerAccount } from '../accounts/useAssetAccounts';

export interface UseFxStateParams {
  type: 'withdrawal' | 'deposit' | 'transfer';
  effectiveCurrencyCode: string | null;
  sourceAccount: AccountPickerAccount | undefined;
  destinationAccount: AccountPickerAccount | undefined;
  amount: string;
  foreignAmount: string;
  isDirty: boolean;
}

export interface FxState {
  accountCurrencyCode: string | null;
  showFx: boolean;
  fxAccount: AccountPickerAccount | undefined;
  foreignAmountInvalid: boolean;
  parsedForeignAmount: string;
  fxMissing: boolean;
  impliedRate: string | null;
}

export function useFxState({
  type,
  effectiveCurrencyCode,
  sourceAccount,
  destinationAccount,
  amount,
  foreignAmount,
  isDirty,
}: UseFxStateParams): FxState {
  const accountCurrencyCode = accountLegCurrency(
    type,
    effectiveCurrencyCode,
    sourceAccount?.currencyCode,
    destinationAccount?.currencyCode,
  );
  const showFx = needsForeignAmount(accountCurrencyCode, effectiveCurrencyCode);

  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [showFx]);

  const fxAccount =
    type === 'deposit'
      ? destinationAccount
      : type === 'withdrawal'
        ? sourceAccount
        : sourceAccount?.currencyCode === effectiveCurrencyCode
          ? destinationAccount
          : sourceAccount;

  const foreignAmountResult =
    showFx && foreignAmount.trim() ? parseDecimalInput(foreignAmount) : null;
  const foreignAmountInvalid = !!foreignAmountResult && !foreignAmountResult.ok;
  const parsedForeignAmount = foreignAmountResult?.ok ? foreignAmountResult.value : '';
  const fxMissing =
    showFx && isDirty && (!parsedForeignAmount || /^0*\.?0*$/.test(parsedForeignAmount));
  const impliedRate =
    showFx && parsedForeignAmount && amount !== '0'
      ? divideDecimal(amount, parsedForeignAmount, 2)
      : null;

  return {
    accountCurrencyCode: accountCurrencyCode ?? null,
    showFx,
    fxAccount,
    foreignAmountInvalid,
    parsedForeignAmount,
    fxMissing,
    impliedRate,
  };
}
