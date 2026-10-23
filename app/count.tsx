// The cash count — the envelope sweep (design §6.9, decision C of §11). Counts every marked
// cash envelope in one pass; one confirm creates one adjustment per envelope that differs.
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useCategories, useCurrencies } from '../src/db/useReferenceData';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
import {
  Button,
  IconButton,
  ModalHeader,
  SCREEN_TOP_PADDING,
  Screen,
  StickyFooter,
  useKeyboardHeight,
} from '../src/ui/kit';
import { PickerSheet } from '../src/ui/PickerSheet';
import { CashSweepPickers } from '../src/reconcile/CashSweepPickers';
import { useCashSweepAccounts } from '../src/reconcile/useCashSweepAccounts';
import type { AccountPickerAccount } from '../src/ui/AccountPickerSheet';
import { currencyOf, formatMoney } from '../src/money/format';
import { parseDecimalInput } from '../src/api/ff3/decimal';
import { relativeTime } from '../src/ui/relativeTime';
import { haptics } from '../src/ui/haptics';
import { hasEnvelopeMarker } from '../src/accounts/envelopeMarker';
import { setAccountEnvelope } from '../src/accounts/accountActions';
import { useAssetAccounts } from '../src/accounts/useAssetAccounts';
import { computeSweep, driftByCurrency, type SweepRow } from '../src/reconcile/sweep';
import {
  describeCountBlocker,
  readCountBlocker,
  useCountReadiness,
} from '../src/reconcile/countReadiness';
import {
  setReconcileShortfallAccountId,
  setReconcileSurplusAccountId,
  setReconcileCategoryName,
} from '../src/settings/appSettings';
import { useSync } from '../src/sync/useSync';
import { useAction } from '../src/ui/useAction';
import { createAndConfirmAdjustment } from '../src/reconcile/adjustment';
import { isBalanceStale } from '../src/utils/day';
import { CountEmptyState } from '../src/reconcile/CountEmptyState';
import { CountEnvelopeCard } from '../src/reconcile/CountEnvelopeCard';
import { CountOtherEnvelopes } from '../src/reconcile/CountOtherEnvelopes';
import { CountStaleView } from '../src/reconcile/CountStaleView';
import { ReviewAdjustmentsSheet } from '../src/reconcile/ReviewAdjustmentsSheet';
import { useReconcileSettings } from '../src/reconcile/useReconcileSettings';

type PickerKind = 'shortfall' | 'surplus' | 'category';

export default function CountScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const keyboardHeight = useKeyboardHeight();

  const categories = useCategories();
  const currencies = useCurrencies();
  const assetAccounts = useAssetAccounts() ?? [];
  const envelopeAccounts = assetAccounts.filter((a) => hasEnvelopeMarker(a.notes));
  const showEmpty = envelopeAccounts.length === 0;

  const {
    expenseAccounts,
    usedExpenseAccounts,
    revenueAccounts,
    usedRevenueAccounts,
    matchingShortfall,
    matchingSurplus,
  } = useCashSweepAccounts();

  const { status: syncStatus, syncNow } = useSync();
  const { blocker, canCount } = useCountReadiness();
  const syncing = syncStatus === 'syncing';

  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [denomCounts, setDenomCounts] = useState<Record<string, Record<string, number>>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [picker, setPicker] = useState<PickerKind | null>(null);

  const {
    shortfallAccountId,
    setShortfallAccountId,
    surplusAccountId,
    setSurplusAccountId,
    reconcileCategory,
    setReconcileCategory,
  } = useReconcileSettings();

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

  const pickShortfall = act(tr('count.shortfallPayee'), async (a: AccountPickerAccount) => {
    await setReconcileShortfallAccountId(db, a.id);
    setShortfallAccountId(a.id || null);
    setPicker(null);
    setReviewOpen(true);
  });
  const pickSurplus = act(tr('count.surplusPayee'), async (a: AccountPickerAccount) => {
    await setReconcileSurplusAccountId(db, a.id);
    setSurplusAccountId(a.id || null);
    setPicker(null);
    setReviewOpen(true);
  });
  const pickCategory = act(tr('count.categoryOptional'), async (key: string | null) => {
    await setReconcileCategoryName(db, key ?? '');
    setReconcileCategory(key);
    setPicker(null);
    setReviewOpen(true);
  });

  const commitEnvelopes = act(tr('count.envelopes'), async (selectedIds: string[]) => {
    for (const id of selectedIds) {
      await setAccountEnvelope(db, id, true);
    }
  });

  const effectiveActiveAccountId =
    activeAccountId && envelopeAccounts.some((a) => a.id === activeAccountId)
      ? activeAccountId
      : (envelopeAccounts[0]?.id ?? null);

  const activeAccount = envelopeAccounts.find((a) => a.id === effectiveActiveAccountId) ?? null;
  const otherAccounts = envelopeAccounts.filter((a) => a.id !== effectiveActiveAccountId);

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

  const countedCount = envelopeAccounts.filter((a) => (counts[a.id] ?? '').trim() !== '').length;
  const skippedCount = envelopeAccounts.length - countedCount;

  if (showEmpty) {
    return (
      <Screen bottom modal>
        <View style={{ flex: 1 }}>
          <ModalHeader
            title={tr('count.title')}
            stepLabel={tr('count.nothingToCount')}
            onClose={() => router.back()}
          />
          <CountEmptyState
            assetAccounts={assetAccounts}
            onCommitEnvelopes={(ids) => void commitEnvelopes(ids)}
            keyboardHeight={keyboardHeight}
          />
        </View>
      </Screen>
    );
  }

  const isStaleOrBlocked = !canCount || stale;

  return (
    <Screen bottom modal>
      <View style={{ flex: 1 }}>
        <ModalHeader
          title={tr('count.title')}
          stepLabel={
            oldestBalanceDate
              ? tr('count.balancesFrom', { relative: relativeTime(oldestBalanceDate) })
              : undefined
          }
          onClose={() => router.back()}
          right={
            <IconButton
              icon="settings-outline"
              label={tr('count.settingsAria')}
              onPress={() => router.push('/settings/cash')}
            />
          }
        />

        {isStaleOrBlocked ? (
          <CountStaleView
            accounts={envelopeAccounts}
            currencies={currencies}
            oldestBalanceDate={oldestBalanceDate}
            blocker={blocker}
            syncing={syncing}
            onSync={() => {
              void syncNow();
            }}
            keyboardHeight={keyboardHeight}
          />
        ) : (
          <>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: t.space.lg,
                paddingTop: SCREEN_TOP_PADDING,
                gap: t.space.md,
                paddingBottom: t.space.lg + keyboardHeight,
              }}
              keyboardShouldPersistTaps="handled"
            >
              {activeAccount && (
                <CountEnvelopeCard
                  account={activeAccount}
                  currencies={currencies}
                  counted={counts[activeAccount.id] ?? ''}
                  onCountedChange={(v) => setCounts((c) => ({ ...c, [activeAccount.id]: v }))}
                  denomCounts={denomCounts[activeAccount.id] ?? {}}
                  onDenomCountsChange={(countsMap) =>
                    setDenomCounts((all) => ({ ...all, [activeAccount.id]: countsMap }))
                  }
                  invalid={invalidCounts.has(activeAccount.id)}
                  adjustment={adjustments.find((adj) => adj.accountId === activeAccount.id)}
                  blocked={!canCount}
                />
              )}

              <CountOtherEnvelopes
                accounts={otherAccounts}
                currencies={currencies}
                counts={counts}
                invalidCounts={invalidCounts}
                adjustments={adjustments}
                onSelectAccount={setActiveAccountId}
              />
            </ScrollView>

            <StickyFooter>
              <View style={{ flex: 1, gap: t.space.sm }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={[t.type.label, { color: t.color.textMuted }]}>
                    {tr('count.countedSummary', {
                      counted: countedCount,
                      total: envelopeAccounts.length,
                      skipped: skippedCount,
                    })}
                  </Text>
                  {drift.length > 0 && (
                    <Text
                      style={[
                        t.type.label,
                        {
                          color: drift.some((d) => d.amount.startsWith('-'))
                            ? t.color.warnStrong
                            : t.color.income,
                          fontWeight: '600',
                        },
                      ]}
                    >
                      {tr('count.drift', {
                        amounts: drift
                          .map((d) => formatMoney(d.amount, currencyOf(currencies, d.currencyCode)))
                          .join(' · '),
                      })}
                    </Text>
                  )}
                </View>
                {footerAction}
              </View>
            </StickyFooter>
          </>
        )}
      </View>

      <ReviewAdjustmentsSheet
        visible={reviewOpen}
        onClose={() => setReviewOpen(false)}
        adjustments={adjustments}
        accounts={envelopeAccounts}
        currencies={currencies}
        counts={counts}
        effectiveShortfall={effectiveShortfall}
        effectiveSurplus={effectiveSurplus}
        reconcileCategory={reconcileCategory}
        onOpenShortfall={() => {
          setReviewOpen(false);
          setPicker('shortfall');
        }}
        onOpenSurplus={() => {
          setReviewOpen(false);
          setPicker('surplus');
        }}
        onOpenCategory={() => {
          setReviewOpen(false);
          setPicker('category');
        }}
        onConfirm={confirmReview}
        confirming={confirming}
        canCount={canCount}
      />

      <CashSweepPickers
        picker={picker === 'shortfall' || picker === 'surplus' ? picker : null}
        onClose={() => {
          setPicker(null);
          setReviewOpen(true);
        }}
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
        onClose={() => {
          setPicker(null);
          setReviewOpen(true);
        }}
        title={tr('count.categoryOptional')}
        options={categories.map((c) => ({ key: c.name, label: c.name }))}
        selected={reconcileCategory}
        noneLabel={tr('common.none')}
        onSelect={(key) => void pickCategory(key)}
      />
    </Screen>
  );
}
