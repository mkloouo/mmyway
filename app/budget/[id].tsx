// One envelope: what is in it, what it held last month, and the ways to change it — assign
// from Ready to Assign, or move money across from another envelope. Its name is edited on the page
// (a Save bar appears on change); Delete and Rename sit behind the •••.
// V4 board 02.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, Text, View } from 'react-native';
import {
  ActionTile,
  Button,
  Card,
  FieldRow,
  Hero,
  ListRow,
  Money,
  MoreButton,
  NoticeBlock,
  ProgressBar,
  PushHeader,
  SCREEN_TOP_PADDING,
  Screen,
  SectionHeader,
} from '../../src/ui/kit';
import { AmountSheet } from '../../src/ui/AmountSheet';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { SaveBar } from '../../src/ui/SaveBar';
import { TextField, type TextFieldRef } from '../../src/ui/TextField';
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
import { navigateOnce } from '../../src/ui/navigateOnce';
import { useEnvelopeTransactions } from '../../src/bucket/useEnvelopeTransactions';

/** Share of the assignment spent, 0–1, for the bar. Overspent is a full bar. Display only. */
function spentFraction(envelope: Envelope): number {
  if (envelope.overspent) return 1;
  const spent = envelope.spent.replace(/^[-−]/, '');
  return Math.min(1, Number(divideDecimal(spent, envelope.assigned, 4)));
}

function EnvelopeScreen() {
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
  const [name, setName] = useState<string | null>(null);
  const nameInputRef = useRef<TextFieldRef>(null);

  const coverHandled = useRef(false);
  useEffect(() => {
    if (!cover || coverHandled.current) return;
    coverHandled.current = true;
    setSheet('giver');
  }, [cover]);

  const queued = bucket.queued.has(budgetId);
  const typedName = name ?? envelope?.name ?? '';
  const renameDirty = name !== null && !queued && typedName !== (envelope?.name ?? '');
  const close = useConfirmDiscard(renameDirty, 'budget.discardTitle');

  const { currency, period } = bucket;
  const transactions = useEnvelopeTransactions(envelope?.budgetId, envelope?.name, period, 3);

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

  const monthLabel = dayDate(period.start).toLocaleString(appLocale(), {
    month: 'long',
    year: 'numeric',
  });
  const shortfall = envelope.overspent ? envelope.available.replace(/^[-−]/, '') : null;
  const lastMonth = bucket.lastPeriod.get(budgetId) ?? null;
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
      { text: tr('budget.renameAction'), onPress: () => nameInputRef.current?.focus() },
      { text: tr('budget.deleteAction'), style: 'destructive', onPress: () => void delete_() },
      { text: tr('common.cancel'), style: 'cancel' },
    ]);

  return (
    <Screen bottom>
      <PushHeader
        backLabel={tr('budget.title')}
        onBack={close}
        right={<MoreButton label={tr('budget.moreAria')} onPress={more} />}
        title={envelope.name}
        subtitle={tr('budget.envelopeSubtitle', { month: monthLabel })}
      />
      <ScrollView
        contentContainerStyle={{
          paddingTop: SCREEN_TOP_PADDING,
          paddingBottom: t.space.xxl,
          gap: t.space.md,
        }}
      >
        <Hero
          caption={tr('budget.availableLabel')}
          style={{ marginHorizontal: t.space.lg }}
          amount={
            <Money
              amount={envelope.available}
              currency={currency}
              size="display"
              tone={envelope.overspent ? 'warn' : undefined}
            />
          }
          tone={envelope.overspent ? 'warn' : 'default'}
        >
          <ProgressBar
            progress={spentFraction(envelope) * 100}
            tone={envelope.overspent ? 'warn' : 'accent'}
          />
          {envelope.overspent && (
            <NoticeBlock
              tone="warn"
              title={tr('budget.overspentCoverNote', {
                amount: formatMoney(envelope.available.replace(/^[-−]/, ''), currency),
              })}
            />
          )}
        </Hero>

        <View style={{ flexDirection: 'row', gap: t.space.sm, marginHorizontal: t.space.lg }}>
          <ActionTile
            icon="wallet-outline"
            label={tr('budget.assignAction')}
            onPress={() => setSheet('assign')}
            disabled={act.pending(tr('budget.assign'))}
          />
          <ActionTile
            icon="swap-horizontal-outline"
            label={tr('budget.moveIn')}
            onPress={() => setSheet('giver')}
            disabled={givers.length === 0 || act.pending(tr('budget.moveHere'))}
          />
          {envelope.overspent && shortfall && (
            <ActionTile
              icon="shield-checkmark-outline"
              label={tr('budget.coverAction', { amount: formatMoney(shortfall, currency) })}
              tone="warn"
              onPress={() => setSheet('giver')}
              disabled={givers.length === 0 || act.pending(tr('budget.moveHere'))}
            />
          )}
        </View>
        {givers.length === 0 && (
          <Text style={[t.type.label, { color: t.color.textMuted, marginHorizontal: t.space.lg }]}>
            {tr('budget.nothingToGive')}
          </Text>
        )}

        <SectionHeader title={tr('budget.thisMonth')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('budget.statAssigned')}
            value={formatMoney(envelope.assigned, currency)}
            chevron
            onPress={() => setSheet('assign')}
          />
          <ListRow
            label={tr('budget.spentLabel')}
            value={formatMoney(envelope.spent.replace(/^[-−]/, ''), currency)}
          />
          <ListRow
            label={tr('budget.lastMonthLabel')}
            value={lastMonth ? formatMoney(lastMonth.assigned, currency) : '—'}
            action={
              lastMonth
                ? {
                    label: tr('budget.useAction'),
                    pill: true,
                    onPress: () => void assign(lastMonth.assigned),
                  }
                : undefined
            }
          />
        </Card>

        <SectionHeader
          title={tr('budget.spentFromIt')}
          action={
            <Button
              size="bar"
              variant="ghost"
              title={tr('budget.allInActivity')}
              onPress={() => router.navigate('/activity')}
            />
          }
        />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          {transactions.length === 0 ? (
            <ListRow first label={tr('budget.noTransactionsThisMonth')} />
          ) : (
            transactions.map((tx, i) => (
              <ListRow
                key={tx.groupId}
                first={i === 0}
                label={tx.description}
                sub={
                  tx.payee
                    ? `${tx.payee} · ${dayDate(tx.date).toLocaleDateString(appLocale(), {
                        month: 'short',
                        day: 'numeric',
                      })}`
                    : dayDate(tx.date).toLocaleDateString(appLocale(), {
                        month: 'short',
                        day: 'numeric',
                      })
                }
                value={`−${formatMoney(tx.amount.replace(/^[-−]/, ''), currency)}`}
                onPress={() => navigateOnce(`/transactions/${encodeURIComponent(tx.groupId)}`)}
              />
            ))
          )}
        </Card>

        <SectionHeader title={tr('budget.envelopeGroup')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <FieldRow first label={tr('budget.nameInline')} labelWidth={80}>
            <TextField
              ref={nameInputRef}
              value={typedName}
              onChangeText={setName}
              invalid={!!problemText}
              testID="envelope-name"
            />
          </FieldRow>
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
