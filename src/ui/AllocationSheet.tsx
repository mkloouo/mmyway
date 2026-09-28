// The Split button's sheet, and the leftover sheet. By default split 1 gives a new split its
// amount (Done on the keypad); "Choose splits" and the leftover sheet show sliders that say how much of an
// amount each split gives (a new split's amount, a lowered total) or gets (a raised total). The
// sliders always add up to the amount — moving one moves the others (src/splits/allocate.ts).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Button, Money, Sheet } from './components';
import { Keypad } from './Keypad';
import { Slider } from './Slider';
import { useTheme } from './theme';
import { formatMoney, type DisplayCurrency } from './money';
import { applyDigit, type KeypadKey } from '../capture/amountInput';
import {
  applyShares,
  balance,
  capsFor,
  defaultShares,
  fromMinor,
  minorToPosition,
  positionToMinor,
  toMinor,
} from '../splits/allocate';

export type AllocationMode =
  /** Split: ask for the new split's amount, then take it from the existing splits. */
  | { kind: 'newSplit' }
  /** Total and splits disagree by `delta` (total minus the splits' sum): spread it over the splits. */
  | { kind: 'leftover'; delta: bigint; exclude?: number };

export interface AllocationResult {
  amounts: string[];
  newAmount?: string;
}

export function AllocationSheet({
  visible,
  mode,
  amounts,
  labels,
  currency,
  type,
  onDone,
  onClose,
}: {
  visible: boolean;
  mode: AllocationMode;
  amounts: string[];
  labels: string[];
  currency: DisplayCurrency;
  type: 'withdrawal' | 'deposit' | 'transfer';
  onDone: (result: AllocationResult) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const dp = currency.decimalPlaces;

  const [typed, setTyped] = useState('0');
  const target =
    mode.kind === 'newSplit' ? toMinor(typed, dp) : mode.delta < 0n ? -mode.delta : mode.delta;
  const delta = mode.kind === 'newSplit' ? -target : mode.delta;
  const caps = capsFor(amounts, delta, dp, mode.kind === 'leftover' ? mode.exclude : undefined);
  const sign: 1 | -1 = delta > 0n ? 1 : -1;
  const fits = defaultShares(target, caps) !== null;

  // Mounted fresh for each use (the screens render it only while open), so the starting state
  // is set here: the amount step for a new split, default shares for a leftover.
  const [step, setStep] = useState<'amount' | 'shares'>(
    mode.kind === 'newSplit' ? 'amount' : 'shares',
  );
  const [shares, setShares] = useState<bigint[]>(() =>
    mode.kind === 'newSplit' ? [] : (defaultShares(target, caps) ?? caps.map(() => 0n)),
  );

  /** "Choose splits": the sliders, starting from the default. */
  function chooseSplits() {
    const initial = defaultShares(target, caps);
    if (!initial || target === 0n) return;
    setShares(initial);
    setStep('shares');
  }

  /** Done on the keypad: split 1 gives the amount (the next splits only what it can't). */
  function takeDefault() {
    const initial = defaultShares(target, caps);
    if (!initial || target === 0n) return;
    onDone({ amounts: applyShares(amounts, initial, sign, dp), newAmount: fromMinor(target, dp) });
  }

  function done() {
    onDone({
      amounts: applyShares(amounts, shares, sign, dp),
      newAmount: mode.kind === 'newSplit' ? fromMinor(target, dp) : undefined,
    });
  }

  const title =
    mode.kind === 'newSplit'
      ? tr('splits.newSplitTitle')
      : sign > 0
        ? tr('splits.assignLeftoverTitle')
        : tr('splits.takeBackTitle');

  if (step === 'amount') {
    const tooMuch = target > 0n && !fits;
    return (
      <Sheet visible={visible} onClose={onClose} title={title}>
        <Money amount={typed} currency={currency} type={type} size="display" />
        <Text style={[t.type.label, { color: tooMuch ? t.color.danger : t.color.textMuted }]}>
          {tooMuch ? tr('splits.moreThanSplits') : tr('splits.newSplitHint')}
        </Text>
        <Keypad
          compact
          onDigit={(key: KeypadKey) => setTyped((v) => applyDigit(v, key, dp))}
          saveLabel={tr('common.done')}
          saveDisabled={target === 0n || tooMuch}
          onSave={takeDefault}
        />
        {amounts.length > 1 && (
          <Button
            title={tr('splits.chooseSplits')}
            variant="secondary"
            onPress={chooseSplits}
            disabled={target === 0n || tooMuch}
          />
        )}
      </Sheet>
    );
  }

  const sum = shares.reduce((a, s) => a + s, 0n);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        <Button title={tr('common.done')} onPress={done} disabled={!fits || sum !== target} />
      }
    >
      <Text style={[t.type.body, { color: t.color.textMuted }]}>
        {!fits
          ? tr('splits.cannotTake', { amount: formatMoney(fromMinor(target, dp), currency) })
          : sign > 0
            ? tr('splits.giveHint', { amount: formatMoney(fromMinor(target, dp), currency) })
            : tr('splits.takeHint', { amount: formatMoney(fromMinor(target, dp), currency) })}
      </Text>
      {fits &&
        amounts.map((amount, i) => {
          const share = shares[i] ?? 0n;
          const cap = caps[i] ?? 0n;
          const after = fromMinor(toMinor(amount, dp) + BigInt(sign) * share, dp);
          return (
            <View key={i} style={{ gap: t.space.xs }}>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md }}
              >
                <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>
                  {labels[i]}
                </Text>
                <Text style={[t.type.body, t.type.money, { color: t.color.text }]}>
                  {`${sign > 0 ? '+' : '−'}${formatMoney(fromMinor(share, dp), currency)}`}
                </Text>
              </View>
              <Slider
                value={minorToPosition(share, cap)}
                disabled={cap === 0n}
                accessibilityLabel={labels[i]}
                onChange={(position) =>
                  setShares((current) =>
                    balance(current, caps, target, i, positionToMinor(position, cap)),
                  )
                }
              />
              <Text style={[t.type.label, { color: t.color.textMuted }]}>
                {tr('splits.becomes', { amount: formatMoney(after, currency) })}
              </Text>
            </View>
          );
        })}
    </Sheet>
  );
}
