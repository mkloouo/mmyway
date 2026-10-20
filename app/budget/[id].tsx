// One envelope: what is in it, what it held last month, and the two ways to change it — assign
// from Ready to Assign, or move money across from another envelope. Its name is edited on the page
// (a Save bar appears on change); Delete is a rare action, so it sits behind the •••.
//
// A move is one queued operation carrying both absolute amounts (src/bucket/actions.ts), so it can
// never half-land and lose money out of the budget.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Button,
  Card,
  Money,
  MoreButton,
  PushHeader,
  ListRow,
  SCREEN_TOP_PADDING,
  Screen,
  SectionHeader,
} from '../../src/ui/kit';
import { AmountSheet } from '../../src/ui/AmountSheet';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { PendingDot } from '../../src/ui/PendingDot';
import { SaveBar } from '../../src/ui/SaveBar';
import { TextField } from '../../src/ui/TextField';
import { useConfirmDiscard } from '../../src/ui/useConfirmDiscard';
import { useTheme } from '../../src/ui/theme';
import { formatMoney } from '../../src/money/format';
import { useAction } from '../../src/ui/useAction';
import { confirmAction, confirmDestructive } from '../../src/ui/confirm';
import { useDb } from '../../src/providers/DbProvider';
import { useBucket } from '../../src/bucket/useBucket';
import { assignToEnvelope, moveBetweenEnvelopes } from '../../src/bucket/actions';
import { envelopeHeadroom, type Envelope } from '../../src/bucket/envelopes';
import { compareDecimal, divideDecimal } from '../../src/api/ff3/decimal';
import { enqueueBudgetRename, enqueueBudgetDelete } from '../../src/bucket/budgetActions';
import { appLocale } from '../../src/i18n';
import { dayDate } from '../../src/utils/day';
import { withFlag } from '../../src/flags/RequireFlag';

/** Share of the assignment spent, 0–1, for the bar. Overspent is a full bar. Display only. */
function spentFraction(envelope: Envelope): number {
  if (envelope.overspent) return 1;
  const spent = envelope.spent.replace(/^[-−]/, '');
  return Math.min(1, Number(divideDecimal(spent, envelope.assigned, 4)));
}

function EnvelopeScreen() {
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
  // null: the name as Firefly III has it. Typed text replaces it until saved or undone.
  const [name, setName] = useState<string | null>(null);
  // Once per visit: reopening it after the user closed the sheet would trap them on this screen.
  const coverHandled = useRef(false);
  useEffect(() => {
    if (!cover || coverHandled.current) return;
    coverHandled.current = true;
    setSheet('giver');
  }, [cover]);

  // A queued rename is shown as pending (PendingDot) until the sync brings the new name back, so
  // the bar does not offer to save the same name twice.
  const queued = bucket.queued.has(budgetId);
  const typedName = name ?? envelope?.name ?? '';
  const renameDirty = name !== null && !queued && typedName !== (envelope?.name ?? '');
  const close = useConfirmDiscard(renameDirty, 'budget.discardTitle');

  if (!envelope) {
    return (
      <Screen bottom>
        <PushHeader backLabel={tr('budget.title')} onBack={close} />
        {bucket.loaded && (
          <Text style={[t.type.body, { color: t.color.textMuted, padding: t.space.lg }]}>
            {tr('budget.envelopeGone')}
          </Text>
        )}
      </Screen>
    );
  }

  const { currency, period } = bucket;
  const monthLabel = dayDate(period.start).toLocaleString(appLocale(), {
    month: 'long',
    year: 'numeric',
  });
  // What it would take to bring an overspent envelope back to zero.
  const shortfall = envelope.overspent ? envelope.available.replace(/^[-−]/, '') : null;
  const lastMonth = bucket.lastPeriod.get(budgetId) ?? null;
  // Only envelopes with something left can give, and never this one to itself.
  const givers = bucket.envelopes.filter(
    (e) => e.budgetId !== budgetId && compareDecimal(envelopeHeadroom(e), '0') > 0,
  );
  const giver = givers.find((e) => e.budgetId === giverId) ?? null;
  const problemText = renameDirty && !typedName.trim() ? tr('budget.emptyNameError') : null;

  const assign = act(tr('budget.assign'), async (amount: string) => {
    await assignToEnvelope(db, period, bucket.currencyCode, envelope, amount);
    router.back();
  });

  const move = act(tr('budget.moveHere'), async (from: Envelope, amount: string) => {
    await moveBetweenEnvelopes(db, period, bucket.currencyCode, from, envelope, amount);
    router.back();
  });

  const rename = act(tr('budget.renameAction'), async () => {
    const next = typedName.trim();
    const ok = await confirmAction(
      tr('budget.renameTitle', { name: next }),
      tr('budget.renameAction'),
    );
    if (!ok) return;
    await enqueueBudgetRename(db, envelope.budgetId, next);
  });

  const delete_ = act(tr('budget.deleteAction'), async () => {
    const ok = await confirmDestructive(
      tr('budget.deleteTitle', { name: envelope.name }),
      tr('budget.deleteAction'),
      tr('budget.deleteBody'),
    );
    if (!ok) return;
    await enqueueBudgetDelete(db, envelope.budgetId, envelope.name);
    router.back();
  });

  const more = () =>
    Alert.alert(envelope.name, undefined, [
      { text: tr('budget.deleteAction'), style: 'destructive', onPress: () => void delete_() },
      { text: tr('common.cancel'), style: 'cancel' },
    ]);

  return (
    <Screen bottom>
      <PushHeader
        backLabel={tr('budget.title')}
        onBack={close}
        right={<MoreButton label={tr('budget.moreLabel')} onPress={more} />}
        title={envelope.name}
        subtitle={tr('budget.envelopeSubtitle', { month: monthLabel })}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: SCREEN_TOP_PADDING,
          paddingBottom: t.space.xxl,
          gap: t.space.sm,
        }}
      >
        <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
            <PendingDot visible={queued} />
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
          <View
            style={{
              height: 8,
              // eslint-disable-next-line no-restricted-syntax -- kit-exception: pre-Kit-V2 literal (MKL-81)
              borderRadius: 4,
              overflow: 'hidden',
              backgroundColor: envelope.overspent ? t.color.warnSoft : t.color.accentSoft,
            }}
          >
            <View
              style={{
                width: `${Math.round(spentFraction(envelope) * 100)}%`,
                height: 8,
                backgroundColor: envelope.overspent ? t.color.warn : t.color.accent,
              }}
            />
          </View>
          {envelope.overspent && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.space.sm,
                backgroundColor: t.color.warnSoft,
                borderRadius: t.radius.md,
                padding: t.space.md,
              }}
            >
              <Ionicons name="warning-outline" size={18} color={t.color.warn} />
              <Text style={[t.type.label, { color: t.color.warn, flex: 1 }]}>
                {tr('budget.overspentBy', {
                  amount: formatMoney(envelope.available.replace(/^[-−]/, ''), currency),
                })}
              </Text>
            </View>
          )}
        </Card>

        <View style={{ flexDirection: 'row', gap: t.space.sm, marginHorizontal: t.space.lg }}>
          <Button
            title={tr('budget.assign')}
            style={{ flex: 1 }}
            onPress={() => setSheet('assign')}
            disabled={act.pending(tr('budget.assign'))}
          />
          <Button
            title={tr('budget.moveHere')}
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => setSheet('giver')}
            disabled={givers.length === 0 || act.pending(tr('budget.moveHere'))}
          />
        </View>
        {givers.length === 0 && (
          <Text style={[t.type.label, { color: t.color.textMuted, marginHorizontal: t.space.lg }]}>
            {tr('budget.nothingToGive')}
          </Text>
        )}

        <SectionHeader title={tr('budget.thisMonth')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('budget.assignedLabel')}
            value={formatMoney(envelope.assigned, currency)}
          />
          <ListRow
            label={tr('budget.spentLabel')}
            value={formatMoney(envelope.spent.replace(/^[-−]/, ''), currency)}
          />
          <ListRow
            label={tr('budget.lastMonthLabel')}
            value={lastMonth ? formatMoney(lastMonth.assigned, currency) : '—'}
          />
        </Card>

        <SectionHeader title={tr('budget.envelopeGroup')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Text style={[t.type.label, { color: t.color.text, marginBottom: t.space.xs }]}>
            {tr('budget.nameLabel')}
          </Text>
          <TextField
            value={typedName}
            onChangeText={setName}
            invalid={!!problemText}
            testID="envelope-name"
          />
        </Card>
      </ScrollView>

      {renameDirty && (
        <SaveBar
          problemText={problemText}
          saving={act.pending(tr('budget.renameAction'))}
          disabled={!!problemText || act.pending(tr('budget.renameAction'))}
          onSave={() => void rename()}
          summary={tr('budget.nameChanged')}
          onUndo={() => setName(null)}
        />
      )}

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

export default withFlag('budget', EnvelopeScreen);
