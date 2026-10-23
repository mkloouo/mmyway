import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Card, Pill, Segmented, Stepper } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { currencyOf, formatMoney } from '../money/format';
import { denominationsFor, totalDenominations } from './denominations';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';
import type { SweepAdjustment } from './sweep';

const INITIAL_VISIBLE_DENOMINATIONS = 6;

export interface CountEnvelopeCardProps {
  account: ReferenceAccountRow;
  currencies: Parameters<typeof currencyOf>[0];
  counted: string;
  onCountedChange: (value: string) => void;
  denomCounts: Record<string, number>;
  onDenomCountsChange: (counts: Record<string, number>) => void;
  invalid: boolean;
  adjustment: SweepAdjustment | undefined;
  blocked: boolean;
}

export function CountEnvelopeCard({
  account,
  currencies,
  counted,
  onCountedChange,
  denomCounts,
  onDenomCountsChange,
  invalid,
  adjustment,
  blocked,
}: CountEnvelopeCardProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const currency = currencyOf(currencies, account.currencyCode);
  const ladder = denominationsFor(account.currencyCode);
  const [mode, setMode] = useState<'total' | 'denominations'>('total');
  const [showAll, setShowAll] = useState(false);

  const expectedFormatted = account.currentBalance
    ? formatMoney(account.currentBalance, currency)
    : '—';

  const matches = counted.trim() !== '' && !invalid && !adjustment;
  const isShort = adjustment?.type === 'withdrawal';
  const isOver = adjustment?.type === 'deposit';

  function handleModeChange(nextMode: string) {
    const m = nextMode as 'total' | 'denominations';
    setMode(m);
    if (m === 'denominations' && ladder) {
      const total = totalDenominations(denomCounts, ladder);
      onCountedChange(total);
    }
  }

  function handleStep(denomValue: string, nextCount: number) {
    if (!ladder) return;
    const nextCounts = { ...denomCounts, [denomValue]: Math.max(0, nextCount) };
    onDenomCountsChange(nextCounts);
    const total = totalDenominations(nextCounts, ladder);
    onCountedChange(total);
  }

  const visibleLadder = ladder
    ? showAll
      ? ladder
      : ladder.slice(0, INITIAL_VISIBLE_DENOMINATIONS)
    : [];

  return (
    <Card flush>
      <View style={{ padding: t.space.lg, gap: t.space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.space.sm }}>
          <Text
            style={[t.type.heading, { color: t.color.text, fontWeight: '600' }]}
            numberOfLines={1}
          >
            {account.name}
          </Text>
          <Text style={[t.type.label, { color: t.color.textMuted }]}>
            {tr('count.expected', { amount: expectedFormatted })}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: t.space.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {tr('count.countedLabel')}
            </Text>
            <TextInput
              value={counted}
              onChangeText={onCountedChange}
              keyboardType="decimal-pad"
              placeholder="—"
              placeholderTextColor={t.color.textFaint}
              editable={!blocked && mode === 'total'}
              style={[
                t.type.largeTitle,
                {
                  fontSize: 32,
                  fontWeight: '700',
                  color: t.color.text,
                  borderBottomWidth: 2,
                  borderBottomColor: invalid ? t.color.danger : t.color.accent,
                  paddingVertical: t.space.xs,
                  paddingHorizontal: 0,
                  fontVariant: ['tabular-nums'],
                },
              ]}
            />
          </View>
          <View style={{ marginBottom: t.space.sm }}>
            {invalid ? (
              <Pill label={tr('common.invalidAmount')} tone="warn" />
            ) : isShort ? (
              <Pill
                label={tr('count.short', { amount: formatMoney(adjustment.amount, currency) })}
                tone="warn"
              />
            ) : isOver ? (
              <Pill
                label={tr('count.over', { amount: formatMoney(adjustment.amount, currency) })}
                tone="income"
              />
            ) : matches ? (
              <Pill label={tr('count.allMatch')} tone="income" />
            ) : null}
          </View>
        </View>

        {!!ladder && !blocked && (
          <Segmented
            options={[
              { key: 'total', label: tr('count.typeTotal') },
              { key: 'denominations', label: tr('count.countNotesCoins') },
            ]}
            value={mode}
            onChange={handleModeChange}
          />
        )}

        {mode === 'denominations' && !!ladder && (
          <View style={{ gap: t.space.xs, marginTop: t.space.xs }}>
            {visibleLadder.map((d) => {
              const count = denomCounts[d.value] ?? 0;
              const subtotal = totalDenominations({ [d.value]: count }, [d]);
              const labelWithCurrency = `${d.label} ${currency.symbol || account.currencyCode}`;
              return (
                <View
                  key={d.value}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    height: 40,
                    gap: t.space.sm,
                  }}
                >
                  <Text
                    style={[
                      t.type.body,
                      {
                        fontWeight: '600',
                        color: t.color.text,
                        width: 72,
                        fontVariant: ['tabular-nums'],
                      },
                    ]}
                  >
                    {labelWithCurrency}
                  </Text>
                  <Stepper
                    value={count}
                    onChange={(v) => handleStep(d.value, v)}
                    min={0}
                    disabled={blocked}
                    decreaseAccessibilityLabel={tr('count.decrease', { denomination: d.label })}
                    increaseAccessibilityLabel={tr('count.increase', { denomination: d.label })}
                  />
                  <Text
                    style={[
                      t.type.label,
                      {
                        color: t.color.textMuted,
                        textAlign: 'right',
                        width: 72,
                        fontVariant: ['tabular-nums'],
                      },
                    ]}
                  >
                    {count > 0 ? formatMoney(subtotal, currency) : '—'}
                  </Text>
                </View>
              );
            })}

            {ladder.length > INITIAL_VISIBLE_DENOMINATIONS && (
              <Pressable
                onPress={() => setShowAll((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={
                  showAll
                    ? tr('count.showFewerDenominations')
                    : tr('count.showAllDenominations', { count: ladder.length })
                }
                style={{ paddingVertical: t.space.sm }}
              >
                <Text style={[t.type.label, { color: t.color.accent, fontWeight: '600' }]}>
                  {showAll
                    ? tr('count.showFewerDenominations')
                    : tr('count.showAllDenominations', { count: ladder.length })}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </Card>
  );
}
