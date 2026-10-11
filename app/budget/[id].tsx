// One envelope: what is in it, what it held last month, and the two ways to change it — assign
// from Ready to Assign, or move money across from another envelope.
//
// A move is one queued operation carrying both absolute amounts (src/bucket/actions.ts), so it can
// never half-land and lose money out of the budget.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import {
  AppBar,
  Button,
  Card,
  CloseButton,
  Money,
  Row,
  Screen,
  SCREEN_TOP_PADDING,
  SectionHeader,
} from '../../src/ui/components';
import { AmountSheet } from '../../src/ui/AmountSheet';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { PendingDot } from '../../src/ui/PendingDot';
import { useTheme } from '../../src/ui/theme';
import { formatMoney } from '../../src/ui/money';
import { useAction } from '../../src/ui/useAction';
import { useDb } from '../../src/providers/DbProvider';
import { useBucket } from '../../src/bucket/useBucket';
import { assignToEnvelope, moveBetweenEnvelopes } from '../../src/bucket/actions';
import { envelopeHeadroom, type Envelope } from '../../src/bucket/envelopes';
import { compareDecimal } from '../../src/api/ff3/decimal';
import { appLocale } from '../../src/i18n';
import { dayDate } from '../../src/utils/day';

export default function EnvelopeScreen() {
  // `cover=1` arrives from the overspent row on the Budget tab: open the move sheet straight away,
  // with the shortfall as the amount.
  const { id: rawId, cover } = useLocalSearchParams<{ id: string; cover?: string }>();
  const budgetId = decodeURIComponent(rawId ?? '');
  const t = useTheme();
  const { t: tr } = useTranslation();
  const db = useDb();
  const act = useAction();
  const bucket = useBucket();
  const envelope = bucket.envelopes.find((e) => e.budgetId === budgetId) ?? null;

  const [sheet, setSheet] = useState<'assign' | 'giver' | 'amount' | null>(null);
  const [giverId, setGiverId] = useState<string | null>(null);
  // Once per visit: reopening it after the user closed the sheet would trap them on this screen.
  const coverHandled = useRef(false);
  useEffect(() => {
    if (!cover || coverHandled.current) return;
    coverHandled.current = true;
    setSheet('giver');
  }, [cover]);

  if (!envelope) {
    return (
      <Screen bottom>
        <AppBar title={tr('budget.title')} left={<CloseButton onPress={() => router.back()} />} />
        {bucket.loaded && (
          <Text style={[t.type.body, { color: t.color.textMuted, padding: t.space.lg }]}>
            {tr('budget.envelopeGone')}
          </Text>
        )}
      </Screen>
    );
  }

  const { currency, period } = bucket;
  // What it would take to bring an overspent envelope back to zero.
  const shortfall = envelope.overspent ? envelope.available.replace(/^[-−]/, '') : null;
  const lastMonth = bucket.lastPeriod.get(budgetId) ?? null;
  // Only envelopes with something left can give, and never this one to itself.
  const givers = bucket.envelopes.filter(
    (e) => e.budgetId !== budgetId && compareDecimal(envelopeHeadroom(e), '0') > 0,
  );
  const giver = givers.find((e) => e.budgetId === giverId) ?? null;

  const assign = act(tr('budget.assign'), async (amount: string) => {
    await assignToEnvelope(db, period, bucket.currencyCode, envelope, amount);
    router.back();
  });

  const move = act(tr('budget.moveHere'), async (from: Envelope, amount: string) => {
    await moveBetweenEnvelopes(db, period, bucket.currencyCode, from, envelope, amount);
    router.back();
  });

  return (
    <Screen bottom>
      <AppBar
        title={envelope.name}
        subtitle={dayDate(period.start).toLocaleString(appLocale(), {
          month: 'long',
          year: 'numeric',
        })}
        left={<CloseButton onPress={() => router.back()} />}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: SCREEN_TOP_PADDING,
          paddingBottom: t.space.xxl,
          gap: t.space.sm,
        }}
      >
        <Card style={{ marginHorizontal: t.space.lg, gap: t.space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
            <PendingDot visible={bucket.queued.has(budgetId)} />
            <Text
              style={[t.type.caption, { color: t.color.textMuted, textTransform: 'uppercase' }]}
            >
              {tr('budget.availableLabel')}
            </Text>
          </View>
          <Money
            amount={envelope.available}
            currency={currency}
            size="display"
            tone={envelope.overspent ? 'warn' : undefined}
          />
          {envelope.overspent && (
            <Text style={[t.type.label, { color: t.color.warn }]}>
              {tr('budget.overspentBy', {
                amount: formatMoney(envelope.available.replace(/^[-−]/, ''), currency),
              })}
            </Text>
          )}
        </Card>

        <SectionHeader title={tr('budget.thisMonth')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row
            first
            label={tr('budget.assignedLabel')}
            value={formatMoney(envelope.assigned, currency)}
          />
          <Row
            label={tr('budget.spentLabel')}
            value={formatMoney(envelope.spent.replace(/^[-−]/, ''), currency)}
          />
          <Row
            label={tr('budget.lastMonthLabel')}
            value={lastMonth ? formatMoney(lastMonth.assigned, currency) : '—'}
          />
        </Card>

        <View style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.md, gap: t.space.sm }}>
          <Button
            title={tr('budget.assign')}
            onPress={() => setSheet('assign')}
            disabled={act.pending(tr('budget.assign'))}
          />
          <Button
            title={tr('budget.moveHere')}
            variant="secondary"
            onPress={() => setSheet('giver')}
            disabled={givers.length === 0 || act.pending(tr('budget.moveHere'))}
          />
          {givers.length === 0 && (
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {tr('budget.nothingToGive')}
            </Text>
          )}
        </View>
      </ScrollView>

      {/* The amount is absolute — what the envelope should hold — which is also why the keypad
          opens on what it holds now rather than on zero. */}
      <AmountSheet
        visible={sheet === 'assign'}
        title={tr('budget.assignTitle', { name: envelope.name })}
        initial={envelope.assigned}
        currency={currency}
        type="transfer"
        onDone={(typed) => {
          setSheet(null);
          if (typed !== null) void assign(typed);
        }}
      />

      <PickerSheet
        visible={sheet === 'giver'}
        onClose={() => setSheet(null)}
        title={tr('budget.moveFrom')}
        options={givers.map((e) => ({
          key: e.budgetId,
          label: `${e.name} · ${formatMoney(e.available, currency)}`,
        }))}
        selected={giverId}
        onSelect={(key) => {
          setGiverId(key);
          if (key) setSheet('amount');
        }}
      />

      {sheet === 'amount' && giver && (
        <AmountSheet
          visible
          title={tr('budget.moveAmountTitle', {
            name: giver.name,
            available: formatMoney(giver.available, currency),
          })}
          // Covering an overspend opens on the shortfall — or on all the giver has, when that is
          // less. Otherwise on everything the giver can give.
          initial={
            shortfall && compareDecimal(shortfall, giver.available) < 0
              ? shortfall
              : giver.available
          }
          currency={currency}
          type="transfer"
          onDone={(typed) => {
            setSheet(null);
            if (typed !== null) void move(giver, typed);
          }}
        />
      )}
    </Screen>
  );
}
