import { renderHook } from '@testing-library/react-native';
import { useFxState } from './useFxState';
import type { AccountPickerAccount } from '../accounts/useAssetAccounts';

const checkingPLN: AccountPickerAccount = {
  id: 'acc-1',
  name: 'Checking PLN',
  currencyCode: 'PLN',
};

const savingsEUR: AccountPickerAccount = {
  id: 'acc-2',
  name: 'Savings EUR',
  currencyCode: 'EUR',
};

describe('useFxState', () => {
  it('hides FX when currencies match', async () => {
    const { result } = await renderHook(() =>
      useFxState({
        type: 'withdrawal',
        effectiveCurrencyCode: 'PLN',
        sourceAccount: checkingPLN,
        destinationAccount: undefined,
        amount: '15.00',
        foreignAmount: '',
        isDirty: true,
      }),
    );

    expect(result.current.showFx).toBe(false);
    expect(result.current.fxMissing).toBe(false);
  });

  it('shows FX when account currency differs from effective currency', async () => {
    const { result } = await renderHook(() =>
      useFxState({
        type: 'withdrawal',
        effectiveCurrencyCode: 'PLN',
        sourceAccount: savingsEUR,
        destinationAccount: undefined,
        amount: '120.00',
        foreignAmount: '27.85',
        isDirty: true,
      }),
    );

    expect(result.current.showFx).toBe(true);
    expect(result.current.accountCurrencyCode).toBe('EUR');
    expect(result.current.fxAccount?.id).toBe('acc-2');
    expect(result.current.foreignAmountInvalid).toBe(false);
    expect(result.current.parsedForeignAmount).toBe('27.85');
    expect(result.current.fxMissing).toBe(false);
    expect(result.current.impliedRate).toBe('4.30');
  });

  it('flags fxMissing when foreign amount is empty but amount is dirty', async () => {
    const { result } = await renderHook(() =>
      useFxState({
        type: 'withdrawal',
        effectiveCurrencyCode: 'PLN',
        sourceAccount: savingsEUR,
        destinationAccount: undefined,
        amount: '120.00',
        foreignAmount: '',
        isDirty: true,
      }),
    );

    expect(result.current.showFx).toBe(true);
    expect(result.current.fxMissing).toBe(true);
  });
});
