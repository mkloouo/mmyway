// Budget — envelope budgeting over Firefly III's own primitives (docs/private/ynab-bucket-budgeting-plan.md).
// Read-only here: the envelopes, the sinking funds, the obligations due, and Ready to Assign.
// Assigning happens on one envelope's page (app/budget/[id].tsx).
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import {
  AppBar,
  Card,
  EmptyState,
  Money,
  Screen,
  SectionHeader,
  SCREEN_TOP_PADDING,
} from '../../src/ui/components';
import { PendingDot } from '../../src/ui/PendingDot';
import { useTheme } from '../../src/ui/theme';
import { formatMoney } from '../../src/ui/money';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { usePullToRefresh } from '../../src/sync/useSync';
import { useBucket } from '../../src/bucket/useBucket';
import { appLocale } from '../../src/i18n';
import { dayDate } from '../../src/utils/day';

export default function BudgetScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const pull = usePullToRefresh();
  const { period, envelopes, funds, bills, rta, currency, queued, loaded } = useBucket();

  const monthLabel = dayDate(period.start).toLocaleString(appLocale(), {
    month: 'long',
    year: 'numeric',
  });
  const unsigned = (amount: string) => formatMoney(amount.replace(/^[-−]/, ''), currency);

  return (
    <Screen>
      <AppBar title={tr('budget.title')} subtitle={monthLabel} />
      <ScrollView
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        contentContainerStyle={{
          paddingTop: SCREEN_TOP_PADDING,
          paddingBottom: t.space.xxl,
          gap: t.space.sm,
        }}
      >
        <Card style={{ marginHorizontal: t.space.lg, gap: t.space.xs }}>
          <Text style={[t.type.caption, { color: t.color.textMuted, textTransform: 'uppercase' }]}>
            {tr('budget.readyToAssign')}
          </Text>
          <Money
            amount={rta.readyToAssign}
            currency={currency}
            size="display"
            tone={rta.readyToAssign.startsWith('-') ? 'warn' : undefined}
          />
          <Text style={[t.type.label, { color: t.color.textMuted }]}>
            {tr('budget.breakdown', {
              cash: formatMoney(rta.cash, currency),
              allocated: formatMoney(rta.allocated, currency),
            })}
          </Text>
          {/* Said where the number is read, not in a FAQ: Firefly III's own "left to budget" is a
              different figure, and nothing in the app can maintain the record it rests on. */}
          <Text style={[t.type.label, { color: t.color.textFaint, marginTop: t.space.xs }]}>
            {tr('budget.differsFromFireflyNote')}
          </Text>
        </Card>

        <SectionHeader title={tr('budget.envelopes')} />
        {envelopes.length === 0 ? (
          loaded ? (
            <EmptyState
              glyph="◴"
              title={tr('budget.noEnvelopesTitle')}
              hint={tr('budget.noEnvelopesHint')}
            />
          ) : null
        ) : (
          envelopes.map((envelope) => (
            <Card
              key={envelope.budgetId}
              style={{ marginHorizontal: t.space.lg }}
              onPress={() => navigateOnce(`/budget/${encodeURIComponent(envelope.budgetId)}`)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                <PendingDot visible={queued.has(envelope.budgetId)} />
                <Text style={[t.type.heading, { color: t.color.text, flex: 1 }]} numberOfLines={1}>
                  {envelope.name}
                </Text>
                <Money
                  amount={envelope.available}
                  currency={currency}
                  size="heading"
                  tone={envelope.overspent ? 'warn' : undefined}
                />
              </View>
              <Text
                style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}
                numberOfLines={1}
              >
                {tr('budget.envelopeLine', {
                  assigned: formatMoney(envelope.assigned, currency),
                  spent: unsigned(envelope.spent),
                })}
              </Text>
            </Card>
          ))
        )}

        {funds.length > 0 && (
          <>
            <SectionHeader title={tr('budget.funds')} />
            {funds.map((fund) => (
              <Card key={fund.id} style={{ marginHorizontal: t.space.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                  <Text
                    style={[t.type.heading, { color: t.color.text, flex: 1 }]}
                    numberOfLines={1}
                  >
                    {fund.name}
                  </Text>
                  <Money amount={fund.saved} currency={currency} size="heading" />
                </View>
                <Text
                  style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}
                  numberOfLines={1}
                >
                  {[
                    fund.target
                      ? tr('budget.fundOfTarget', { target: formatMoney(fund.target, currency) })
                      : tr('budget.fundOpenEnded'),
                    fund.targetDate &&
                      tr('budget.fundBy', {
                        date: dayDate(fund.targetDate).toLocaleDateString(appLocale()),
                      }),
                    fund.accountName,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Card>
            ))}
          </>
        )}

        {bills.length > 0 && (
          <>
            <SectionHeader title={tr('budget.dueThisPeriod')} />
            {bills.map((bill) => (
              <Card key={bill.billId} style={{ marginHorizontal: t.space.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                  <Text
                    style={[t.type.heading, { color: t.color.text, flex: 1 }]}
                    numberOfLines={1}
                  >
                    {bill.name}
                  </Text>
                  <Money amount={bill.amount} currency={currency} size="heading" />
                </View>
                <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>
                  {dayDate(bill.date).toLocaleDateString(appLocale())}
                </Text>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
