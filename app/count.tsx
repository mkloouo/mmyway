// The cash count — the envelope sweep (design §6.9, decision C of §11). Counts every marked
// cash envelope in one pass; one confirm creates one adjustment per envelope that differs.
import { logLine } from '../src/utils/log';
import { errorMessage } from '../src/utils/errorMessage';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { eq, inArray } from 'drizzle-orm';
import { useLiveQuery } from '../src/db/useLiveQuery';
import { useCategories, useCurrencies } from '../src/db/useReferenceData';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
// prettier-ignore
import { Button, Card, Dot, GroupFooter, ListRow, ModalHeader, Money, NoticeBlock, SCREEN_TOP_PADDING, Screen, SectionHeader, Sheet, StickyFooter, SwitchRow, useKeyboardHeight } from '../src/ui/kit';
import { PickerSheet } from '../src/ui/PickerSheet';
import { CashSweepPickers } from '../src/reconcile/CashSweepPickers';
import { useCashSweepAccounts } from '../src/reconcile/useCashSweepAccounts';
import type { AccountPickerAccount } from '../src/ui/AccountPickerSheet';
import { currencyOf, formatMoney } from '../src/money/format';
import { parseDecimalInput } from '../src/api/ff3/decimal';
import { relativeTime } from '../src/ui/relativeTime';
import { haptics } from '../src/ui/haptics';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { outboxOperations, appSettings } from '../src/db/schema';
import { hasEnvelopeMarker } from '../src/accounts/envelopeMarker';
import { setAccountEnvelope } from '../src/accounts/accountActions';
import { useAssetAccounts } from '../src/accounts/useAssetAccounts';
import { computeSweep, driftByCurrency, type SweepRow } from '../src/reconcile/sweep';
import { denominationsFor, totalDenominations } from '../src/reconcile/denominations';
import {
  countBlocker,
  describeCountBlocker,
  readCountBlocker,
} from '../src/reconcile/countReadiness';
import {
  getReconcileShortfallAccountId,
  setReconcileShortfallAccountId,
  getReconcileSurplusAccountId,
  setReconcileSurplusAccountId,
  getReconcileCategoryName,
  setReconcileCategoryName,
  BALANCES_STALE_KEY,
} from '../src/settings/appSettings';
import { useSync } from '../src/sync/useSync';
import { LEDGER_KINDS } from '../src/sync/outbox';
import { TextField } from '../src/ui/TextField';
import { useAction } from '../src/ui/useAction';
import { createAndConfirmAdjustment } from '../src/reconcile/adjustment';
import { PendingDot } from '../src/ui/PendingDot';
import { usePendingAccountIds } from '../src/accounts/usePendingAccountIds';
import { isBalanceStale } from '../src/utils/day';

type PickerKind = 'shortfall' | 'surplus' | 'category';

export default function CountScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const pendingAccounts = usePendingAccountIds();
  // Edge to edge, the window isn't resized for the keyboard; the lower envelopes need the room.
  const keyboardHeight = useKeyboardHeight();

  const categories = useCategories();
  const currencies = useCurrencies();
  const assetAccounts = useAssetAccounts() ?? [];
  const envelopeAccounts = assetAccounts.filter((a) => hasEnvelopeMarker(a.notes));
  const {
    expenseAccounts,
    usedExpenseAccounts,
    revenueAccounts,
    usedRevenueAccounts,
    matchingShortfall,
    matchingSurplus,
  } = useCashSweepAccounts();

  // The expected balances are only right once every queued write has reached FF3 and the
  // balances were read after that (src/reconcile/countReadiness.ts). Unknown until both load.
  const { status: syncStatus, syncNow } = useSync();
  const { data: queuedLedgerOps } = useLiveQuery(
    db
      .select({ id: outboxOperations.id })
      .from(outboxOperations)
      .where(inArray(outboxOperations.kind, [...LEDGER_KINDS])),
  );
  const { data: staleRows } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.key, BALANCES_STALE_KEY)),
  );
  const readinessLoaded = queuedLedgerOps !== undefined && staleRows !== undefined;
  const blocker = readinessLoaded
    ? countBlocker(queuedLedgerOps.length, staleRows[0]?.value === '1')
    : null;
  const canCount = readinessLoaded && !blocker;
  const syncing = syncStatus === 'syncing';

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [denomAccountId, setDenomAccountId] = useState<string | null>(null);
  const [denomCounts, setDenomCounts] = useState<Record<string, number>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [picker, setPicker] = useState<PickerKind | null>(null);

  const [shortfallAccountId, setShortfallAccountIdState] = useState<string | null>(null);
  const [surplusAccountId, setSurplusAccountIdState] = useState<string | null>(null);
  const [reconcileCategory, setReconcileCategoryState] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getReconcileShortfallAccountId(db),
      getReconcileSurplusAccountId(db),
      getReconcileCategoryName(db),
    ])
      .then(([sf, sp, cat]) => {
        if (cancelled) return;
        setShortfallAccountIdState(sf);
        setSurplusAccountIdState(sp);
        setReconcileCategoryState(cat);
      })
      .catch((err) => logLine('warn', `reconcile settings failed: ${errorMessage(err)}`));
    return () => {
      cancelled = true;
    };
  }, [db]);

  // A raw typed comma used to reach addDecimal (sweep.ts) unparsed and crash the screen —
  // parseDecimalInput here both normalizes it and catches what it rejects, before that.
  const invalidCounts = new Set(
    envelopeAccounts
      .filter((a) => {
        const raw = counts[a.id] ?? '';
        return (
          !!raw.trim() &&
          !parseDecimalInput(raw, currencyOf(currencies, a.currencyCode).decimalPlaces).ok
        );
      })
      .map((a) => a.id),
  );
  const sweepRows: SweepRow[] = envelopeAccounts.map((a) => {
    const raw = counts[a.id] ?? '';
    const result = raw.trim()
      ? parseDecimalInput(raw, currencyOf(currencies, a.currencyCode).decimalPlaces)
      : null;
    return {
      accountId: a.id,
      currencyCode: a.currencyCode,
      expected: a.currentBalance ?? '0',
      counted: result?.ok ? result.value : '',
    };
  });
  const adjustments = computeSweep(sweepRows);
  const drift = driftByCurrency(sweepRows);
  const countedRows = sweepRows.filter((r) => r.counted.trim());

  const oldestBalanceDate =
    envelopeAccounts
      .map((a) => a.currentBalanceDate)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;
  const stale = isBalanceStale(oldestBalanceDate);

  const selectedShortfall = expenseAccounts.find((a) => a.id === shortfallAccountId);
  const effectiveShortfall = selectedShortfall ?? matchingShortfall ?? null;
  const effectiveShortfallId = effectiveShortfall?.id ?? null;

  const selectedSurplus = revenueAccounts.find((a) => a.id === surplusAccountId);
  const effectiveSurplus = selectedSurplus ?? matchingSurplus ?? null;
  const effectiveSurplusId = effectiveSurplus?.id ?? null;

  const confirmReview = act(tr('inbox.confirm'), async () => {
    // Re-read at the moment of booking: a write can be queued, or a sync land, while the
    // review sheet is open.
    const current = await readCountBlocker(db);
    if (current) {
      setReviewOpen(false);
      Alert.alert(tr('count.outOfDateTitle'), describeCountBlocker(current));
      return;
    }
    for (const adjustment of adjustments) {
      await createAndConfirmAdjustment(db, adjustment, {
        shortfallAccountId: effectiveShortfallId,
        surplusAccountId: effectiveSurplusId,
        categoryName: reconcileCategory,
      });
    }
    haptics.tick();
    setReviewOpen(false);
    router.back();
  });
  const confirming = act.pending(tr('inbox.confirm'));

  // One sheet at a time: the settings sheet hands over to a picker, and the picker hands back.
  function openPicker(kind: PickerKind) {
    setSettingsOpen(false);
    setPicker(kind);
  }
  function closePicker() {
    setPicker(null);
    setSettingsOpen(true);
  }

  const pickShortfall = act(tr('count.shortfallPayee'), async (a: AccountPickerAccount) => {
    await setReconcileShortfallAccountId(db, a.id);
    setShortfallAccountIdState(a.id || null);
  });
  const pickSurplus = act(tr('count.surplusPayee'), async (a: AccountPickerAccount) => {
    await setReconcileSurplusAccountId(db, a.id);
    setSurplusAccountIdState(a.id || null);
  });
  const pickCategory = act(tr('count.categoryOptional'), async (key: string | null) => {
    await setReconcileCategoryName(db, key ?? '');
    setReconcileCategoryState(key);
  });

  // Per-account name: the handler guard is keyed by its action, so two toggles don't block each other.
  function toggleEnvelope(accountId: string, name: string, on: boolean) {
    void act(`${tr('count.envelopes')}: ${name}`, () => setAccountEnvelope(db, accountId, on))();
  }

  function openDenomPad(accountId: string) {
    setDenomAccountId(accountId);
    setDenomCounts({});
  }
  function stepDenom(value: string, delta: number) {
    setDenomCounts((c) => ({ ...c, [value]: Math.max(0, (c[value] ?? 0) + delta) }));
  }
  function applyDenomTotal() {
    if (!denomAccountId) return;
    const account = envelopeAccounts.find((a) => a.id === denomAccountId);
    const ladder = account ? denominationsFor(account.currencyCode) : null;
    if (ladder) {
      const total = totalDenominations(denomCounts, ladder);
      setCounts((c) => ({ ...c, [denomAccountId]: total }));
    }
    setDenomAccountId(null);
  }

  const denomAccount = envelopeAccounts.find((a) => a.id === denomAccountId) ?? null;
  const denomLadder = denomAccount ? denominationsFor(denomAccount.currencyCode) : null;
  const denomCurrency = currencyOf(currencies, denomAccount?.currencyCode ?? '');
  const denomTotal = denomLadder ? totalDenominations(denomCounts, denomLadder) : '0';

  const valueText = (s: string) => (
    <Text style={[t.type.body, { color: t.color.textMuted }]}>{s}</Text>
  );

  // The one primary action at the bottom of the count.
  let footerAction: ReactNode;
  if (invalidCounts.size > 0) {
    footerAction = <Button title={tr('count.fixInvalid')} variant="secondary" disabled />;
  } else if (blocker) {
    footerAction = (
      <Button
        title={tr('count.syncFirst')}
        onPress={() => syncNow()}
        disabled={syncing}
        size="lg"
      />
    );
  } else if (countedRows.length > 0 && adjustments.length === 0) {
    footerAction = <Button title={tr('count.allMatch')} variant="secondary" disabled />;
  } else {
    footerAction = (
      <Button
        title={tr('count.reviewCount', { count: adjustments.length })}
        onPress={() => setReviewOpen(true)}
        disabled={adjustments.length === 0}
        size="lg"
      />
    );
  }

  return (
    <Screen bottom modal>
      <View style={{ flex: 1 }}>
        <ModalHeader
          title={tr('count.title')}
          stepLabel={
            oldestBalanceDate
              ? tr('count.asOf', { time: relativeTime(oldestBalanceDate) })
              : undefined
          }
          onClose={() => router.back()}
        />
        {stale && envelopeAccounts.length > 0 && !blocker && (
          <View style={{ marginHorizontal: t.space.lg, marginBottom: t.space.sm }}>
            <NoticeBlock title={tr('count.staleBanner')} tone="warn" />
          </View>
        )}
        {!!blocker && envelopeAccounts.length > 0 && (
          <View style={{ marginHorizontal: t.space.lg, marginBottom: t.space.sm }}>
            <NoticeBlock
              title={tr('count.outOfDateTitle')}
              body={describeCountBlocker(blocker)}
              action={{
                label: syncing ? tr('sync.syncing') : tr('sync.syncNow'),
                onPress: () => {
                  void syncNow();
                },
                disabled: syncing,
              }}
              tone="warn"
            />
          </View>
        )}

        {envelopeAccounts.length === 0 ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              padding: t.space.lg,
              gap: t.space.sm,
              paddingBottom: t.space.lg + keyboardHeight,
            }}
          >
            <Text style={[t.type.heading, { color: t.color.text }]}>{tr('count.emptyTitle')}</Text>
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {tr('count.emptyHint')}
            </Text>
            {assetAccounts.length === 0 ? (
              <Button
                title={tr('count.goToAccounts')}
                onPress={() => router.push('/settings/accounts')}
              />
            ) : (
              <>
                <SectionHeader title={tr('count.yourAccounts')} />
                <Card flush>
                  {assetAccounts.map((a, index) => (
                    <SwitchRow
                      key={a.id}
                      first={index === 0}
                      label={a.name}
                      value={false}
                      onValueChange={(on) => toggleEnvelope(a.id, a.name, on)}
                    />
                  ))}
                </Card>
                <GroupFooter>{tr('count.switchHint')}</GroupFooter>
              </>
            )}
          </ScrollView>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: t.space.lg,
              paddingTop: SCREEN_TOP_PADDING,
              gap: t.space.sm,
              paddingBottom: t.space.lg + keyboardHeight,
            }}
            keyboardShouldPersistTaps="handled"
          >
            <SectionHeader
              title={tr('count.envelopes')}
              first
              action={
                <Button
                  title={tr('count.settingsLabel')}
                  variant="ghost"
                  size="bar"
                  onPress={() => setSettingsOpen(true)}
                />
              }
            />
            <Card flush>
              {envelopeAccounts.map((a, index) => {
                const currency = currencyOf(currencies, a.currencyCode);
                const counted = counts[a.id] ?? '';
                const invalid = invalidCounts.has(a.id);
                const adjustment = adjustments.find((adj) => adj.accountId === a.id);
                const matches = counted.trim() !== '' && !invalid && !adjustment;
                const ladder = denominationsFor(a.currencyCode);
                // Stale balances: the rows are only a reference, so nothing can be typed in them.
                const blocked = !!blocker;
                return (
                  <View
                    key={a.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: t.space.sm,
                      minHeight: 52,
                      paddingHorizontal: t.space.lg,
                      paddingVertical: t.space.sm,
                      borderTopWidth: index > 0 ? 1 : 0,
                      borderTopColor: t.color.border,
                      opacity: blocked ? 0.5 : 1,
                    }}
                  >
                    <View
                      style={{
                        flex: 1,
                        gap: 2 /* eslint-disable-line no-restricted-syntax -- kit-exception: pre-Kit-V2 literal (MKL-81) */,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                        <Text
                          style={[t.type.body, { color: t.color.text, flexShrink: 1 }]}
                          numberOfLines={1}
                        >
                          {a.name}
                        </Text>
                        <PendingDot visible={pendingAccounts.has(a.id)} />
                      </View>
                      <Text style={[t.type.label, { color: t.color.textMuted }]}>
                        {tr('count.expected', {
                          amount: a.currentBalance ? formatMoney(a.currentBalance, currency) : '—',
                        })}
                      </Text>
                      {invalid && (
                        <Text style={[t.type.label, { color: t.color.danger }]}>
                          {tr('common.invalidAmount')}
                        </Text>
                      )}
                    </View>
                    <TextField
                      value={counted}
                      onChangeText={(v) => setCounts((c) => ({ ...c, [a.id]: v }))}
                      keyboardType="decimal-pad"
                      placeholder="—"
                      editable={!blocked}
                      invalid={invalid}
                      style={{ width: 110, textAlign: 'right' }}
                    />
                    {!!ladder && (
                      <Pressable
                        onPress={() => openDenomPad(a.id)}
                        disabled={blocked}
                        accessibilityRole="button"
                        accessibilityLabel={tr('count.byDenomination', { name: a.name })}
                        hitSlop={4}
                        style={{
                          width: 36,
                          height: 36,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons name="calculator-outline" size={22} color={t.color.accent} />
                      </Pressable>
                    )}
                    <View style={{ minWidth: 64, alignItems: 'flex-end' }}>
                      {invalid ? null : matches ? (
                        <Text style={[t.type.body, { color: t.color.income, fontWeight: '600' }]}>
                          ✓
                        </Text>
                      ) : adjustment ? (
                        <Money
                          amount={
                            adjustment.type === 'withdrawal'
                              ? `-${adjustment.amount}`
                              : adjustment.amount
                          }
                          currency={currency}
                        />
                      ) : (
                        <Text style={[t.type.body, { color: t.color.textFaint }]}>
                          {tr('count.skip')}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </Card>
          </ScrollView>
        )}

        {envelopeAccounts.length > 0 && (
          <StickyFooter>
            <View style={{ flex: 1, gap: t.space.sm }}>
              {drift.length > 0 && (
                <Text style={[t.type.label, { color: t.color.textMuted, textAlign: 'center' }]}>
                  {tr('count.drift', {
                    amounts: drift
                      .map((d) => formatMoney(d.amount, currencyOf(currencies, d.currencyCode)))
                      .join(' · '),
                  })}
                </Text>
              )}
              {footerAction}
            </View>
          </StickyFooter>
        )}
      </View>

      <Sheet
        visible={!!denomAccountId}
        onClose={() => setDenomAccountId(null)}
        title={tr('count.denominationsTitle')}
        footer={
          <Button
            title={tr('count.useAmount', {
              amount: formatMoney(denomTotal, denomCurrency),
            })}
            onPress={applyDenomTotal}
          />
        }
      >
        {!!denomLadder && (
          <Card flush>
            {denomLadder.map((d, index) => {
              const n = denomCounts[d.value] ?? 0;
              return (
                <View
                  key={d.value}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: t.space.md,
                    minHeight: 52,
                    paddingHorizontal: t.space.lg,
                    borderTopWidth: index > 0 ? 1 : 0,
                    borderTopColor: t.color.border,
                  }}
                >
                  <Text style={[t.type.body, { color: t.color.text, flex: 1 }]}>{d.label}</Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      borderRadius: t.radius.sm,
                      backgroundColor: t.color.surfaceAlt,
                    }}
                  >
                    <Pressable
                      onPress={() => stepDenom(d.value, -1)}
                      accessibilityRole="button"
                      accessibilityLabel={tr('count.decrease', { denomination: d.label })}
                      hitSlop={4}
                      style={{
                        width: 40,
                        height: 36,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="remove" size={18} color={t.color.text} />
                    </Pressable>
                    <Text
                      style={[
                        t.type.body,
                        {
                          color: t.color.text,
                          minWidth: 32,
                          textAlign: 'center',
                          fontVariant: ['tabular-nums'],
                        },
                      ]}
                    >
                      {n}
                    </Text>
                    <Pressable
                      onPress={() => stepDenom(d.value, 1)}
                      accessibilityRole="button"
                      accessibilityLabel={tr('count.increase', { denomination: d.label })}
                      hitSlop={4}
                      style={{
                        width: 40,
                        height: 36,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="add" size={18} color={t.color.text} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
            <ListRow
              label={tr('count.runningTotal')}
              trailing={<Money amount={denomTotal} currency={denomCurrency} />}
            />
          </Card>
        )}
      </Sheet>

      <Sheet
        visible={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title={tr('count.reviewTitle')}
        footer={
          <Button
            title={
              confirming
                ? tr('draft.confirming')
                : tr('count.confirmCount', { count: adjustments.length })
            }
            onPress={confirmReview}
            disabled={confirming || !canCount}
          />
        }
      >
        <Card flush>
          {adjustments.map((a, index) => {
            const account = envelopeAccounts.find((acc) => acc.id === a.accountId);
            const withdrawal = a.type === 'withdrawal';
            return (
              <ListRow
                key={a.accountId}
                first={index === 0}
                leading={<Dot color={withdrawal ? t.color.danger : t.color.income} />}
                label={`${account?.name ?? a.accountId}: ${withdrawal ? '−' : '+'}${formatMoney(
                  a.amount,
                  currencyOf(currencies, a.currencyCode),
                )}`}
              />
            );
          })}
        </Card>
        <SectionHeader title={tr('count.bookedAs')} />
        <Card flush>
          <ListRow
            first
            label={tr('count.missingCashTitle')}
            sub={tr('count.expenseAccountSub')}
            trailing={valueText(effectiveShortfall?.name ?? tr('count.defaultPayeeShortfall'))}
            chevron
            onPress={() => {
              setReviewOpen(false);
              setSettingsOpen(true);
            }}
          />
          <ListRow
            label={tr('count.extraCashTitle')}
            sub={tr('count.revenueAccountSub')}
            trailing={valueText(effectiveSurplus?.name ?? tr('count.defaultPayeeSurplus'))}
            chevron
            onPress={() => {
              setReviewOpen(false);
              setSettingsOpen(true);
            }}
          />
          <ListRow
            label={tr('fields.category')}
            trailing={valueText(reconcileCategory ?? tr('common.none'))}
            chevron
            onPress={() => {
              setReviewOpen(false);
              setSettingsOpen(true);
            }}
          />
        </Card>
      </Sheet>

      <Sheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={tr('count.settingsTitle')}
      >
        <Card flush>
          <ListRow
            first
            label={tr('count.shortfallPayee')}
            trailing={valueText(effectiveShortfall?.name ?? tr('count.defaultPayeeShortfall'))}
            chevron
            onPress={() => openPicker('shortfall')}
          />
          <ListRow
            label={tr('count.surplusPayee')}
            trailing={valueText(effectiveSurplus?.name ?? tr('count.defaultPayeeSurplus'))}
            chevron
            onPress={() => openPicker('surplus')}
          />
          <ListRow
            label={tr('count.categoryOptional')}
            trailing={valueText(reconcileCategory ?? tr('common.none'))}
            chevron
            onPress={() => openPicker('category')}
          />
        </Card>
      </Sheet>

      <CashSweepPickers
        picker={picker === 'shortfall' || picker === 'surplus' ? picker : null}
        onClose={closePicker}
        expenseAccounts={expenseAccounts}
        usedExpenseAccounts={usedExpenseAccounts}
        revenueAccounts={revenueAccounts}
        usedRevenueAccounts={usedRevenueAccounts}
        currencies={currencies}
        selectedShortfallId={selectedShortfall?.id ?? effectiveShortfallId}
        selectedSurplusId={selectedSurplus?.id ?? effectiveSurplusId}
        onSelectShortfall={(a) => void pickShortfall(a)}
        onSelectSurplus={(a) => void pickSurplus(a)}
      />
      <PickerSheet
        visible={picker === 'category'}
        onClose={closePicker}
        title={tr('count.categoryOptional')}
        options={categories.map((c) => ({ key: c.name, label: c.name }))}
        selected={reconcileCategory}
        noneLabel={tr('common.none')}
        onSelect={(key) => void pickCategory(key)}
      />
    </Screen>
  );
}
