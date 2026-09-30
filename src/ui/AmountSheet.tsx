// The amount keypad in a sheet, for a screen whose value is stored rather than held in state (the
// draft: every change goes to SQLite and comes back through a live query). Digits are typed into
// this component's own state and handed over once, when the sheet closes:
//  - a digit shows at once — writing each one to the database and waiting for the live query to
//    bring it back took at least 100 ms per digit, and re-rendered every page of a receipt with it;
//  - two quick taps both apply, since each starts from what the last one typed, not from the
//    last render of the screen (the bug Capture's reducer fixed in 1.4.0).
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyDigit, type KeypadKey } from '../capture/amountInput';
import { Keypad } from './Keypad';
import { Money, Sheet } from './components';
import type { DisplayCurrency } from './money';

export function AmountSheet({
  visible,
  title,
  initial,
  currency,
  type,
  loading,
  onDone,
}: {
  visible: boolean;
  title: string;
  /** The amount when the sheet opens; typing starts from it. */
  initial: string;
  currency: DisplayCurrency;
  type: 'withdrawal' | 'deposit' | 'transfer';
  loading?: boolean;
  /** Done, the scrim or Android back: the typed amount, or null when nothing was typed. */
  onDone: (typed: string | null) => void;
}) {
  const { t: tr } = useTranslation();
  const [typed, setTyped] = useState<string | null>(null);
  const latest = useRef<string | null>(null);

  function press(key: KeypadKey) {
    const next = applyDigit(latest.current ?? initial, key, currency.decimalPlaces);
    latest.current = next;
    setTyped(next);
  }

  function finish() {
    const value = latest.current;
    latest.current = null;
    setTyped(null);
    onDone(value);
  }

  return (
    <Sheet visible={visible} onClose={finish} title={title}>
      <Money
        amount={typed ?? initial}
        currency={currency}
        type={type}
        size="display"
        loading={loading}
      />
      <Keypad compact onDigit={press} saveLabel={tr('common.done')} onSave={finish} />
    </Sheet>
  );
}
