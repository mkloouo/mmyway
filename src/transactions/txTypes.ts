// The three transaction types and the words the app uses for them (capture's type chips), not
// FF3's "Withdrawal"/"Deposit". Kept in one place so a screen can't drift from the others.
import type { TxType } from '../splits/editSplits';

export const TX_TYPES: { type: TxType; labelKey: string }[] = [
  { type: 'withdrawal', labelKey: 'capture.typeExpense' },
  { type: 'deposit', labelKey: 'capture.typeIncome' },
  { type: 'transfer', labelKey: 'capture.typeTransfer' },
];

/** The label key for a type, or null for a type FF3 gave us that the app doesn't show. */
export function txTypeLabelKey(type: string): string | null {
  return TX_TYPES.find((x) => x.type === type)?.labelKey ?? null;
}
