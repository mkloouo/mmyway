// Budget — envelope budgeting over Firefly III's own primitives (docs/private/ynab-bucket-budgeting-plan.md).
// The envelopes, the sinking funds, the obligations due, Ready to Assign, and the one-tap auto-fill.
// Assigning to a single envelope happens on its own page (app/budget/[id].tsx).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import {
  AppBar,
  Button,
  Card,
  EmptyState,
  Money,
  Row,
  Screen,
  SectionHeader,
  SCREEN_TOP_PADDING,
} from '../../src/ui/components';
import { AmountSheet } from '../../src/ui/AmountSheet';
import { PendingDot } from '../../src/ui/PendingDot';
import { useTheme } from '../../src/ui/theme';
import { formatMoney } from '../../src/ui/money';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { useAction } from '../../src/ui/useAction';
import { confirmAction } from '../../src/ui/confirm';
import { usePullToRefresh } from '../../src/sync/useSync';
import { useDb } from '../../src/providers/DbProvider';
import { useBucket } from '../../src/bucket/useBucket';
import { autofill, autofillCount, autofillIsEmpty } from '../../src/bucket/autofill';
import { assignMany, fundMany, setFundAmount } from '../../src/bucket/actions';
import type { Fund } from '../../src/bucket/funds';
import { appLocale } from '../../src/i18n';
import { dayDate, localDay } from '../../src/utils/day';

export default function BudgetScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const db = useDb();
  const act = useAction();
  const pull = usePullToRefresh();
  const bucket = useBucket();
  const { period, envelopes, funds, bills, rta, currency, queued, queuedFunds, loaded } = bucket;

  const monthLabel = dayDate(period.start).toLocaleString(appLocale(), {
    month: 'long',
    year: 'numeric',
  });
  const unsigned = (amount: string) => formatMoney(amount.replace(/^[-−]/, ''), currency);

  // "Do what I did last month", worked out before the button is drawn: nothing planned, no button.
  const plan = autofill({
    readyToAssign: rta.readyToAssign,
    envelopes,
    lastPeriod: bucket.lastPeriod,
    funds,
    today: localDay(),
    decimalPlaces: currency.decimalPlaces,
  });

  const runAutofill = act(tr('budget.autofill'), async () => {
    // It moves real money across several envelopes and funds at once; it gets a confirmation with
    // the total and the count, not a bare tap.
    const ok = await confirmAction(
      tr('budget.autofillTitle'),
      tr('budget.autofillConfirm'),
      tr('budget.autofillBody', {
        amount: formatMoney(plan.total, currency),
        count: autofillCount(plan),
      }),
    );
    if (!ok) return;
    await assignMany(db, period, bucket.currencyCode, plan.envelopes);
    await fundMany(db, plan.funds);
  });

  const [editing, setEditing] = useState<Fund | null>(null);
  const saveFund = act(tr('budget.fundSet'), async (fund: Fund, amount: string) => {
    await setFundAmount(db, fund, amount);
  });

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
          {!autofillIsEmpty(plan) && (
            <Button
              title={tr('budget.autofillWith', { amount: formatMoney(plan.total, currency) })}
              variant="secondary"
              onPress={() => void runAutofill()}
              disabled={act.pending(tr('budget.autofill'))}
              style={{ marginTop: t.space.sm }}
            />
          )}
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
              {/* An overspent envelope says so and offers the way out: the move sheet from Phase 2,
                  opened on this envelope with the shortfall already filled in. */}
              {envelope.overspent && (
                <Row
                  label={tr('budget.coverRow', { amount: unsigned(envelope.available) })}
                  icon="arrow-forward"
                  tone="warn"
                  onPress={() =>
                    navigateOnce(`/budget/${encodeURIComponent(envelope.budgetId)}?cover=1`)
                  }
                />
              )}
            </Card>
          ))
        )}

        {funds.length > 0 && (
          <>
            <SectionHeader title={tr('budget.funds')} />
            {funds.map((fund) => (
              <Card
                key={fund.id}
                style={{ marginHorizontal: t.space.lg }}
                // No linked account means no field FF3 would let us write: read-only then.
                onPress={fund.accountId ? () => setEditing(fund) : undefined}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                  <PendingDot visible={queuedFunds.has(fund.id)} />
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

      {/* Absolute: the keypad opens on what the fund already holds, and Done sets it to what is
          typed. FF3 clamps an over-target amount silently, so actions.ts clamps it first. */}
      {editing && (
        <AmountSheet
          visible
          title={tr('budget.fundSetTitle', { name: editing.name })}
          initial={editing.saved}
          currency={currency}
          type="transfer"
          onDone={(typed) => {
            const fund = editing;
            setEditing(null);
            if (typed !== null) void saveFund(fund, typed);
          }}
        />
      )}
    </Screen>
  );
}
