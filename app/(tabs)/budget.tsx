// Budget — envelope budgeting over Firefly III's own primitives (docs/private/ynab-bucket-budgeting-plan.md).
// The envelopes, the sinking funds, the obligations due, Ready to Assign, and the one-tap auto-fill.
// V4 board 01.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView } from 'react-native';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  SCREEN_TOP_PADDING,
  Screen,
  SectionHeader,
  TabHeader,
} from '../../src/ui/kit';
import { AmountSheet } from '../../src/ui/AmountSheet';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { NewEnvelopeSheet } from '../../src/budget/NewEnvelopeSheet';
import { EnvelopeRow } from '../../src/budget/EnvelopeRow';
import { RtaInfoSheet } from '../../src/budget/RtaInfoSheet';
import { BudgetHero } from '../../src/budget/BudgetHero';
import { BudgetFundsSection } from '../../src/budget/BudgetFundsSection';
import { BudgetBillsSection } from '../../src/budget/BudgetBillsSection';
import { BudgetMonthSwitcher } from '../../src/budget/BudgetMonthSwitcher';
import {
  setEnvelopeOrder,
  sortEnvelopesByOrder,
  useEnvelopeOrder,
} from '../../src/budget/envelopeOrder';
import { addDecimal } from '../../src/api/ff3/decimal';
import type { Envelope } from '../../src/bucket/envelopes';
import { useTheme } from '../../src/ui/theme';
import { formatMoney } from '../../src/money/format';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { useAction } from '../../src/ui/useAction';
import { confirmAction } from '../../src/ui/confirm';
import { usePullToRefresh } from '../../src/sync/useSync';
import { useDb } from '../../src/providers/DbProvider';
import { useBucket } from '../../src/bucket/useBucket';
import { autofill, autofillCount } from '../../src/bucket/autofill';
import { assignMany, assignToEnvelope, fundMany, setFundAmount } from '../../src/bucket/actions';
import type { Fund } from '../../src/bucket/funds';
import { appLocale } from '../../src/i18n';
import { dayDate, localDay } from '../../src/utils/day';
import { nextPeriod, periodOf, previousPeriod, type Period } from '../../src/bucket/period';
import { withFlag } from '../../src/flags/RequireFlag';
import { DragList } from '../../src/ui/DragList';

function BudgetScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const db = useDb();
  const act = useAction();
  const pull = usePullToRefresh();

  // Period / month switcher: default to current month, limited forward to current + 1.
  const [selectedPeriod, setSelectedPeriod] = useState<Period>(() => periodOf(localDay()));
  const currentPeriod = useMemo(() => periodOf(localDay()), []);
  const maxPeriod = useMemo(() => nextPeriod(currentPeriod), [currentPeriod]);
  const isFutureLimit = selectedPeriod.start >= maxPeriod.start;

  const bucket = useBucket(selectedPeriod);
  const { period, envelopes, funds, bills, rta, currency, queued, queuedFunds, loaded } = bucket;

  // Custom envelope display order
  const envelopeOrder = useEnvelopeOrder(db);
  const sortedEnvelopes = useMemo(
    () => sortEnvelopesByOrder(envelopes, envelopeOrder),
    [envelopes, envelopeOrder],
  );

  const monthLabel = dayDate(period.start).toLocaleString(appLocale(), {
    month: 'long',
    year: 'numeric',
  });

  // Total spent across envelopes for the period
  const totalSpent = useMemo(
    () => envelopes.reduce((sum, e) => addDecimal(sum, e.spent.replace(/^[-−]/, '')), '0'),
    [envelopes],
  );

  // Auto-fill plan
  const plan = autofill({
    readyToAssign: rta.readyToAssign,
    envelopes,
    lastPeriod: bucket.lastPeriod,
    funds,
    today: localDay(),
    decimalPlaces: currency.decimalPlaces,
  });

  const runAutofill = act(tr('budget.autofill'), async () => {
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

  // Sheets and interaction states
  const [creating, setCreating] = useState(false);
  const [editingFund, setEditingFund] = useState<Fund | null>(null);
  const [showRtaInfo, setShowRtaInfo] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Assign money states
  const [assignPickerOpen, setAssignPickerOpen] = useState(false);
  const [assigningEnvelope, setAssigningEnvelope] = useState<Envelope | null>(null);

  const saveFund = act(tr('budget.fundSet'), async (fund: Fund, amount: string) => {
    await setFundAmount(db, fund, amount);
  });

  const saveAssignment = act(tr('budget.assign'), async (envelope: Envelope, amount: string) => {
    await assignToEnvelope(db, period, bucket.currencyCode, envelope, amount);
  });

  const onAssignMoney = () => {
    if (sortedEnvelopes.length === 0) {
      setCreating(true);
      return;
    }
    if (sortedEnvelopes.length === 1) {
      setAssigningEnvelope(sortedEnvelopes[0]!);
      return;
    }
    setAssignPickerOpen(true);
  };

  const handleMoveEnvelope = async (from: number, to: number) => {
    const next = [...sortedEnvelopes];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    const newOrder: Record<string, number> = {};
    next.forEach((e, idx) => {
      newOrder[e.budgetId] = idx;
    });
    await setEnvelopeOrder(db, newOrder);
  };

  return (
    <Screen>
      <TabHeader
        title={tr('budget.title')}
        right={
          <IconButton
            icon="add"
            label={tr('budget.createTitle')}
            onPress={() => setCreating(true)}
          />
        }
      />

      {/* Month switcher (Board 01) */}
      <BudgetMonthSwitcher
        monthLabel={monthLabel}
        onPrevious={() => setSelectedPeriod(previousPeriod(selectedPeriod))}
        onNext={() => setSelectedPeriod(nextPeriod(selectedPeriod))}
        isFutureLimit={isFutureLimit}
      />

      <ScrollView
        scrollEnabled={!isDragging}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        contentContainerStyle={{
          paddingTop: SCREEN_TOP_PADDING,
          paddingBottom: t.space.xxl,
          gap: t.space.sm,
        }}
      >
        {/* Hero: Ready to assign (Board 01) */}
        <BudgetHero
          rta={rta}
          currency={currency}
          totalSpent={totalSpent}
          plan={plan}
          onInfoPress={() => setShowRtaInfo(true)}
          onAssignMoney={onAssignMoney}
          onAutofill={() => void runAutofill()}
          isAutofillPending={act.pending(tr('budget.autofill'))}
        />

        {/* Envelopes section (Board 01) */}
        <SectionHeader
          title={`${tr('budget.envelopes')} · ${sortedEnvelopes.length}`}
          action={
            sortedEnvelopes.length > 1 ? (
              <Button
                title={reordering ? tr('common.done') : tr('budget.reorder')}
                variant="ghost"
                size="bar"
                onPress={() => setReordering(!reordering)}
              />
            ) : undefined
          }
        />

        {sortedEnvelopes.length === 0 ? (
          loaded ? (
            <EmptyState
              glyph="◴"
              title={tr('budget.noEnvelopesTitle')}
              hint={tr('budget.noEnvelopesHint')}
            />
          ) : null
        ) : reordering ? (
          <Card flush style={{ marginHorizontal: t.space.lg }}>
            <DragList
              items={sortedEnvelopes}
              keyOf={(e) => e.budgetId}
              renderItem={(envelope, index) => (
                <EnvelopeRow
                  envelope={envelope}
                  currency={currency}
                  pending={queued.has(envelope.budgetId)}
                  first={index === 0}
                  onPress={() => navigateOnce(`/budget/${encodeURIComponent(envelope.budgetId)}`)}
                  onCover={() =>
                    navigateOnce(`/budget/${encodeURIComponent(envelope.budgetId)}?cover=1`)
                  }
                />
              )}
              onMove={handleMoveEnvelope}
              gap={0}
              onDragChange={setIsDragging}
              moveLabels={{ up: tr('budget.moveUp'), down: tr('budget.moveDown') }}
            />
          </Card>
        ) : (
          <Card flush style={{ marginHorizontal: t.space.lg }}>
            {sortedEnvelopes.map((envelope, index) => (
              <EnvelopeRow
                key={envelope.budgetId}
                envelope={envelope}
                currency={currency}
                pending={queued.has(envelope.budgetId)}
                first={index === 0}
                onPress={() => navigateOnce(`/budget/${encodeURIComponent(envelope.budgetId)}`)}
                onCover={() =>
                  navigateOnce(`/budget/${encodeURIComponent(envelope.budgetId)}?cover=1`)
                }
              />
            ))}
          </Card>
        )}

        {/* Sinking funds (Board 01: one Group with income ProgressBar) */}
        <BudgetFundsSection
          funds={funds}
          queuedFunds={queuedFunds}
          currency={currency}
          onEditFund={(fund) => setEditingFund(fund)}
        />

        {/* Due this month (Board 01: one Group with DateTile and "Planned" action) */}
        <BudgetBillsSection bills={bills} currency={currency} />
      </ScrollView>

      {/* Sinking fund edit amount sheet */}
      {editingFund && (
        <AmountSheet
          visible
          title={tr('budget.fundSetTitle', { name: editingFund.name })}
          initial={editingFund.saved}
          currency={currency}
          type="transfer"
          onDone={(typed) => {
            const fund = editingFund;
            setEditingFund(null);
            if (typed !== null) void saveFund(fund, typed);
          }}
        />
      )}

      {/* New envelope modal */}
      <NewEnvelopeSheet
        visible={creating}
        onClose={() => setCreating(false)}
        currency={currency}
        currencyCode={bucket.currencyCode}
        readyToAssign={rta.readyToAssign}
        period={period}
      />

      {/* RTA explanation sheet */}
      <RtaInfoSheet visible={showRtaInfo} onClose={() => setShowRtaInfo(false)} />

      {/* Envelope picker for "Assign money" primary action */}
      {assignPickerOpen && (
        <PickerSheet
          visible
          title={tr('budget.selectEnvelope')}
          options={sortedEnvelopes.map((e) => ({
            key: e.budgetId,
            label: e.name,
            trailing: formatMoney(e.available, currency),
          }))}
          selected={null}
          onSelect={(key) => {
            setAssignPickerOpen(false);
            if (!key) return;
            const target = sortedEnvelopes.find((e) => e.budgetId === key);
            if (target) setAssigningEnvelope(target);
          }}
          onClose={() => setAssignPickerOpen(false)}
        />
      )}

      {/* AmountSheet for "Assign money" */}
      {assigningEnvelope && (
        <AmountSheet
          visible
          title={tr('budget.assignTitle', { name: assigningEnvelope.name })}
          initial={assigningEnvelope.assigned}
          currency={currency}
          type="transfer"
          onDone={(amount) => {
            const target = assigningEnvelope;
            setAssigningEnvelope(null);
            if (amount !== null) void saveAssignment(target, amount);
          }}
        />
      )}
    </Screen>
  );
}

export default withFlag('budget', BudgetScreen);
