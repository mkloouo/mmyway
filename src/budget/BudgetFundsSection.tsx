// Sinking funds group in the Budget tab (Board 01).
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { divideDecimal } from '../api/ff3/decimal';
import type { Fund } from '../bucket/funds';
import { appLocale } from '../i18n';
import { formatMoney, type DisplayCurrency } from '../money/format';
import { Card, Money, ProgressBar, SectionHeader } from '../ui/kit';
import { PendingDot } from '../ui/PendingDot';
import { useTheme } from '../ui/theme';
import { dayDate } from '../utils/day';

export function BudgetFundsSection({
  funds,
  queuedFunds,
  currency,
  onEditFund,
}: {
  funds: Fund[];
  queuedFunds: Set<string>;
  currency: DisplayCurrency;
  onEditFund: (fund: Fund) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  if (funds.length === 0) return null;

  return (
    <>
      <SectionHeader title={tr('budget.funds')} />
      <Card flush style={{ marginHorizontal: t.space.lg }}>
        {funds.map((fund, index) => {
          const targetNum = fund.target ? Number(fund.target) : 0;
          const progress =
            targetNum > 0 ? Math.min(1, Number(divideDecimal(fund.saved, fund.target!, 4))) : 0;

          return (
            <Pressable
              key={fund.id}
              onPress={fund.accountId ? () => onEditFund(fund) : undefined}
              accessibilityRole={fund.accountId ? 'button' : undefined}
              style={({ pressed }) => ({
                paddingHorizontal: t.space.lg,
                paddingVertical: t.space.md,
                gap: 7,
                opacity: pressed && fund.accountId ? 0.6 : 1,
              })}
            >
              {index > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: t.space.lg,
                    right: 0,
                    height: 1,
                    backgroundColor: t.color.border,
                  }}
                />
              )}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: t.space.sm,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: t.space.xs,
                    flex: 1,
                  }}
                >
                  <PendingDot visible={queuedFunds.has(fund.id)} />
                  <Text
                    style={[t.type.body, { color: t.color.text, fontWeight: '600', flex: 1 }]}
                    numberOfLines={1}
                  >
                    {fund.name}
                  </Text>
                </View>
                <Money amount={fund.saved} currency={currency} size="heading" />
              </View>
              <ProgressBar progress={progress} tone="income" height={6} />
              <Text style={[t.type.caption, { color: t.color.textMuted }]} numberOfLines={1}>
                {[
                  fund.target
                    ? tr('budget.fundOfTarget', {
                        target: formatMoney(fund.target, currency),
                      })
                    : tr('budget.fundOpenEnded'),
                  fund.targetDate &&
                    tr('budget.fundBy', {
                      date: dayDate(fund.targetDate).toLocaleDateString(appLocale(), {
                        month: 'short',
                        year: 'numeric',
                      }),
                    }),
                  fund.accountName,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Pressable>
          );
        })}
      </Card>
    </>
  );
}
