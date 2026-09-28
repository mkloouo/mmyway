// Inbox (design §6.1) — the approval queue. Only ever holds unfinished work; confirmed/synced
// items leave every section (see src/inbox/useInboxSections.ts).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, SectionList, Text, View } from 'react-native';
import { usePopOnChange } from '../../src/ui/feedback';
import { Collapsible, leaveThen } from '../../src/ui/Collapsible';
import { useTranslation } from 'react-i18next';
import { inArray } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useCurrencies } from '../../src/db/useReferenceData';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  AppBar,
  BarIconButton,
  SectionHeader,
  Button,
  StatusPill,
  EmptyState,
  Sheet,
  Banner,
} from '../../src/ui/components';
import { currencyOf, formatMoney } from '../../src/ui/money';
import { CaptureDock } from '../../src/ui/CaptureDock';
import { SyncSheet } from '../../src/ui/SyncSheet';
import { haptics } from '../../src/ui/haptics';
import { Snackbar, type SnackbarEntry } from '../../src/ui/Snackbar';
import { relativeTime } from '../../src/ui/relativeTime';
import {
  useInboxSections,
  type AttentionItem,
  type ConfirmEntry,
  type InboxItemRow,
  type QueuedChange,
} from '../../src/inbox/useInboxSections';
import {
  confirmInboxItem,
  undoConfirm,
  type ConfirmResult,
} from '../../src/inbox/createManualEntry';
import { deleteInboxItem, retryErroredItem } from '../../src/inbox/updateDraft';
import { confirmDestructive } from '../../src/ui/confirm';
import {
  approveRecurringReview,
  editRecurringReview,
  deleteRecurringReview,
} from '../../src/sync/recurringReview';
import { discardOperation, retryOperationNow } from '../../src/sync/outbox';
import { requestSync } from '../../src/sync/syncTrigger';
import { parseDecimalInput, trimDecimal } from '../../src/api/ff3/decimal';
import { reportErrors } from '../../src/ui/reportError';
import { useSync, useSignedIn, usePullToRefresh } from '../../src/sync/useSync';
import { outboxOperations } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import { generateId } from '../../src/utils/id';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { appLocale } from '../../src/i18n';
import { readReviewJournal, reviewForeign } from '../../src/inbox/draftJson';
import { AccountPickerSheet } from '../../src/ui/AccountPickerSheet';
import { TextField } from '../../src/ui/TextField';
import { useAction } from '../../src/ui/useAction';
import { ConfirmCard, ReviewCard, AttentionCard, QueuedCard } from '../../src/ui/InboxCards';
import { useSelection } from '../../src/ui/useSelection';
import { useHasSyncedBefore } from '../../src/sync/useHasSyncedBefore';

type SectionKey = 'attention' | 'confirm' | 'review' | 'queued';
type SectionRow = AttentionItem | InboxItemRow | QueuedChange | ConfirmEntry;

const UNDO_WINDOW_MS = 5000; // matches the Snackbar's visible time

export default function InboxScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const { needsAttention, toConfirm, toReview, queued } = useInboxSections();
  // Only what the pill counts — not every payload in the queue.
  const { data: outbox } = useLiveQuery(
    db
      .select({ id: outboxOperations.id })
      .from(outboxOperations)
      .where(inArray(outboxOperations.status, ['pending', 'failed'])),
  );
  const currencies = useCurrencies();
  const hasSyncedBefore = useHasSyncedBefore();
  const { status, summary, syncNow } = useSync();
  const pull = usePullToRefresh();

  const assetAccounts = useAssetAccounts() ?? [];
  const pendingOutboxCount = (outbox ?? []).length;

  // A sync that clears the queue gets a success haptic (design §3.4) — adjusted during render
  // (React's pattern for reacting to a derived value changing), not in an effect.
  const [prevPendingOutboxCount, setPrevPendingOutboxCount] = useState(pendingOutboxCount);
  // Bumped with the success haptic; the sync pill pops on it (src/ui/feedback.ts).
  const [queueClears, setQueueClears] = useState(0);
  if (pendingOutboxCount !== prevPendingOutboxCount) {
    if (prevPendingOutboxCount > 0 && pendingOutboxCount === 0) {
      haptics.success();
      setQueueClears((n) => n + 1);
    }
    setPrevPendingOutboxCount(pendingOutboxCount);
  }
  const pillPop = usePopOnChange(queueClears, 1.15);

  const hasCredentials = useSignedIn();

  const [syncSheetOpen, setSyncSheetOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<SnackbarEntry | null>(null);
  const dismissSnackbar = useCallback(() => setSnackbar(null), []);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [confirmProgress, setConfirmProgress] = useState({ done: 0, total: 0 });
  const [editingReview, setEditingReview] = useState<{
    id: string;
    amount: string;
    currencyCode: string;
    accountId: string | null;
    foreign: { amount: string; currencyCode: string } | null;
  } | null>(null);
  const [pickingReviewAccount, setPickingReviewAccount] = useState(false);

  // Multi-select (long-press a card): bulk confirm or delete.
  const {
    selectedIds,
    selecting,
    toggleSelected: toggle,
    clearSelection,
    leavingIds,
    setLeavingIds,
  } = useSelection();
  // A card here has no long-press pop of its own, so the tick comes from the toggle.
  function toggleSelected(id: string) {
    haptics.tick();
    toggle(id);
  }

  // A swiped-away draft disappears at once and is only really deleted after its Undo window —
  // the swipe used to stop on a confirmation dialog.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const deleteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = deleteTimers.current;
    // Leaving the screen commits whatever is still waiting.
    return () => {
      for (const [id, timer] of timers) {
        clearTimeout(timer);
        void deleteInboxItem(db, id);
      }
      timers.clear();
    };
  }, [db]);

  function forgetLeaving(ids: string[]) {
    setLeavingIds((cur) => new Set([...cur].filter((id) => !ids.includes(id))));
  }
  function deleteWithUndo(ids: string[]) {
    leaveThen(ids, setLeavingIds, () => setHiddenIds((cur) => new Set([...cur, ...ids])));
    for (const id of ids) {
      deleteTimers.current.set(
        id,
        setTimeout(() => {
          deleteTimers.current.delete(id);
          void deleteInboxItem(db, id);
        }, UNDO_WINDOW_MS),
      );
    }
    haptics.tick();
    setSnackbar({
      id: generateId(),
      message:
        ids.length > 1 ? tr('inbox.deletedCount', { count: ids.length }) : tr('inbox.deleted'),
      actionLabel: tr('common.undo'),
      onAction: () => {
        for (const id of ids) {
          clearTimeout(deleteTimers.current.get(id));
          deleteTimers.current.delete(id);
        }
        setHiddenIds((cur) => new Set([...cur].filter((id) => !ids.includes(id))));
        forgetLeaving(ids);
      },
    });
  }

  function showConfirmedSnackbar(batch: { id: string; result: ConfirmResult }[]) {
    setSnackbar({
      id: generateId(),
      message:
        batch.length > 1
          ? tr('inbox.confirmedCount', { count: batch.length })
          : tr('inbox.confirmed'),
      actionLabel: tr('common.undo'),
      onAction: async () => {
        const outcomes = await Promise.all(
          batch.map(({ id, result }) => undoConfirm(db, id, result)),
        );
        forgetLeaving(batch.map(({ id }) => id));
        setSnackbar({
          id: generateId(),
          message: outcomes.includes('already_sent') ? tr('inbox.alreadySent') : tr('inbox.undone'),
        });
      },
    });
  }

  function confirmSingle(item: InboxItemRow) {
    haptics.tick();
    leaveThen([item.id], setLeavingIds, () =>
      reportErrors(
        tr('inbox.confirm'),
        async () => {
          const result = await confirmInboxItem(db, item.id);
          showConfirmedSnackbar([{ id: item.id, result }]);
        },
        (message) => {
          forgetLeaving([item.id]);
          setSnackbar({ id: generateId(), message });
        },
      ),
    );
  }

  const visibleToConfirm = toConfirm.filter((entry) => !hiddenIds.has(entry.id));
  const readyToConfirm = visibleToConfirm.filter((entry) => entry.confirmable);

  async function confirmAll() {
    if (confirmingAll || readyToConfirm.length < 2) return;
    setConfirmingAll(true);
    setConfirmProgress({ done: 0, total: readyToConfirm.length });
    const batch: { id: string; result: ConfirmResult }[] = [];
    let failed = false;
    try {
      await reportErrors(
        tr('inbox.confirmAll'),
        async () => {
          for (const item of readyToConfirm) {
            const result = await confirmInboxItem(db, item.id);
            batch.push({ id: item.id, result });
            setConfirmProgress((p) => ({ ...p, done: p.done + 1 }));
          }
        },
        (message) => {
          failed = true;
          setSnackbar({
            id: generateId(),
            message:
              batch.length > 0
                ? tr('inbox.failedAfter', { message, count: batch.length })
                : message,
          });
        },
      );
    } finally {
      setConfirmingAll(false);
    }
    if (failed || batch.length === 0) return;
    haptics.tick();
    showConfirmedSnackbar(batch);
  }

  const retryError = act(tr('inbox.retry'), async (id: string) => {
    await retryErroredItem(db, id);
    // A retried receipt is re-read by the sync; don't make it wait for the next app resume.
    requestSync();
  });
  const discardError = act(tr('inbox.discard'), async (id: string) => {
    if (
      !(await confirmDestructive(
        tr('inbox.discardItemTitle'),
        tr('inbox.discard'),
        tr('inbox.discardItemBody'),
      ))
    )
      return;
    await deleteInboxItem(db, id);
  });
  function deleteSelected() {
    const ids = [...selectedIds];
    clearSelection();
    deleteWithUndo(ids);
  }
  async function confirmSelected() {
    const ready = visibleToConfirm.filter(
      (entry) => selectedIds.has(entry.id) && entry.confirmable,
    );
    clearSelection();
    if (ready.length === 0) {
      haptics.warn();
      setSnackbar({ id: generateId(), message: tr('inbox.noneReady') });
      return;
    }
    haptics.tick();
    const ids = ready.map((item) => item.id);
    leaveThen(ids, setLeavingIds, async () => {
      const batch: { id: string; result: ConfirmResult }[] = [];
      await reportErrors(
        tr('inbox.confirm'),
        async () => {
          for (const item of ready)
            batch.push({ id: item.id, result: await confirmInboxItem(db, item.id) });
        },
        (message) => {
          forgetLeaving(ids.filter((id) => !batch.some((b) => b.id === id)));
          setSnackbar({ id: generateId(), message });
        },
      );
      if (batch.length > 0) showConfirmedSnackbar(batch);
    });
  }
  const discardReview = act(tr('common.delete'), async (id: string) => {
    if (
      !(await confirmDestructive(
        tr('inbox.deleteReviewTitle'),
        tr('common.delete'),
        tr('inbox.deleteReviewBody'),
      ))
    )
      return;
    await deleteRecurringReview(db, id);
  });
  const retryOpNow = act(tr('inbox.retryNow'), async (opId: string) => {
    await retryOperationNow(db, opId);
    syncNow();
  });
  const discardOp = act(tr('inbox.discard'), async (opId: string) => {
    if (
      !(await confirmDestructive(
        tr('inbox.discardChangeTitle'),
        tr('inbox.discard'),
        tr('inbox.discardChangeBody'),
      ))
    )
      return;
    await discardOperation(db, opId);
  });
  function resolveConflict(groupId: string) {
    navigateOnce(`/transactions/${groupId}`);
  }

  function startEditReview(item: InboxItemRow) {
    const journal = readReviewJournal(item.draftJson);
    const foreign = reviewForeign(journal);
    // FF3 booked the planned 7.99 USD as 7.99 PLN — that number isn't the charge, so start empty.
    const amount =
      foreign && journal.amount && trimDecimal(journal.amount) === trimDecimal(foreign.amount)
        ? ''
        : trimDecimal(journal.amount ?? '');
    setEditingReview({
      id: item.id,
      amount,
      currencyCode: journal.currency_code ?? '',
      accountId: journal.source_id ?? null,
      foreign,
    });
  }
  const editAccount = editingReview
    ? assetAccounts.find((a) => a.id === editingReview.accountId)
    : undefined;
  // The currency is the account's: picking another account changes it.
  const editCurrencyCode = editAccount?.currencyCode ?? editingReview?.currencyCode ?? '';
  const editForeign =
    editingReview?.foreign && editingReview.foreign.currencyCode !== editCurrencyCode
      ? editingReview.foreign
      : null;
  const editAmountResult = editingReview ? parseDecimalInput(editingReview.amount) : null;
  const editAmountInvalid = !!editingReview?.amount && !!editAmountResult && !editAmountResult.ok;
  // A double-tap here used to enqueue two recurring_review operations; `act` drops the second.
  const saveEditReview = act(
    tr('common.save'),
    async () => {
      if (!editingReview || !editAmountResult?.ok) return;
      await editRecurringReview(db, editingReview.id, {
        amount: editAmountResult.value,
        currency_code: editCurrencyCode,
        ...(editingReview.accountId ? { source_id: editingReview.accountId } : {}),
        ...(editForeign
          ? {
              foreign_amount: editForeign.amount,
              foreign_currency_code: editForeign.currencyCode,
            }
          : {}),
      });
      setEditingReview(null);
    },
    (message) => setSnackbar({ id: generateId(), message }),
  );
  const savingReview = act.pending(tr('common.save'));

  const allSections: { key: SectionKey; title: string; data: SectionRow[] }[] = [
    { key: 'attention', title: tr('inbox.sectionAttention'), data: needsAttention },
    { key: 'confirm', title: tr('inbox.sectionConfirm'), data: visibleToConfirm },
    { key: 'review', title: tr('inbox.sectionReview'), data: toReview },
    { key: 'queued', title: tr('inbox.sectionQueued'), data: queued },
  ];
  const sections = allSections.filter((s) => s.data.length > 0);

  // One chain, not two over the same five conditions: the state and its label can't drift apart.
  const { state: pillState, label: pillLabel } = ((): {
    state: 'ok' | 'syncing' | 'queued' | 'offline' | 'error';
    label: string;
  } => {
    if (status === 'syncing') return { state: 'syncing', label: tr('sync.syncing') };
    if (hasCredentials === false) return { state: 'offline', label: tr('sync.notSignedIn') };
    if (summary?.error) return { state: 'error', label: tr('sync.error') };
    if (summary && !summary.ff3Reachable) return { state: 'offline', label: tr('sync.offline') };
    if (pendingOutboxCount > 0)
      return { state: 'queued', label: tr('sync.queued', { count: pendingOutboxCount }) };
    return { state: 'ok', label: relativeTime(summary?.lastSyncedAt) };
  })();

  const subtitleParts: string[] = [];
  if (toConfirm.length > 0)
    subtitleParts.push(tr('inbox.toConfirmCount', { count: toConfirm.length }));
  if (toReview.length > 0)
    subtitleParts.push(tr('inbox.toReviewCount', { count: toReview.length }));
  const dateTitle = new Date().toLocaleDateString(appLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });

  const showOfflineBanner =
    hasCredentials === true && summary && !summary.ff3Reachable && pendingOutboxCount > 0;
  // undefined until the first read lands, so a synced-but-empty Inbox doesn't flash "Nothing
  // synced yet" before flipping to "Inbox zero" once the probe resolves.

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {selecting ? (
          <AppBar
            title={tr('inbox.selected', { count: selectedIds.size })}
            left={
              <BarIconButton
                icon="close"
                label={tr('inbox.cancelSelection')}
                onPress={clearSelection}
              />
            }
            right={
              <>
                <Button
                  title={tr('inbox.confirm')}
                  variant="secondary"
                  size="bar"
                  onPress={confirmSelected}
                />
                <Button
                  title={tr('common.delete')}
                  variant="danger"
                  size="bar"
                  onPress={deleteSelected}
                />
              </>
            }
          />
        ) : (
          <AppBar
            title={dateTitle}
            subtitle={subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined}
            right={
              <Pressable
                onPress={() => setSyncSheetOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={tr('sync.statusLabel')}
              >
                <Animated.View style={pillPop}>
                  <StatusPill state={pillState} label={pillLabel} />
                </Animated.View>
              </Pressable>
            }
          />
        )}
        {!!showOfflineBanner && (
          <Banner>{`⚑ ${tr('inbox.offlineBanner', { count: pendingOutboxCount })}`}</Banner>
        )}

        {/* Always mounted (empty states go in ListEmptyComponent) so pull-to-refresh works on an
            empty Inbox too. */}
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.id}
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          contentContainerStyle={{ paddingBottom: 140 }}
          ListEmptyComponent={
            <>
              {hasCredentials === false && (
                <EmptyState
                  glyph="⚡"
                  title={tr('inbox.connectTitle')}
                  hint={tr('inbox.connectHint')}
                  action={
                    <Button
                      title={tr('inbox.goToSettings')}
                      onPress={() => navigateOnce('/settings')}
                    />
                  }
                />
              )}
              {hasCredentials === true && hasSyncedBefore === false && (
                <EmptyState
                  glyph="↻"
                  title={tr('inbox.nothingSyncedTitle')}
                  hint={tr('inbox.nothingSyncedHint')}
                />
              )}
              {hasCredentials === true && hasSyncedBefore === true && (
                <EmptyState
                  glyph="✓"
                  title={tr('inbox.zeroTitle')}
                  hint={tr('inbox.zeroHint')}
                  action={
                    <View style={{ flexDirection: 'row', gap: t.space.md }}>
                      <Button
                        title={`＋ ${tr('common.add')}`}
                        onPress={() => navigateOnce('/capture')}
                      />
                      <Button
                        title="📷"
                        accessibilityLabel={tr('dock.captureReceipt')}
                        variant="secondary"
                        onPress={() => navigateOnce('/receipt')}
                      />
                    </View>
                  }
                />
              )}
            </>
          }
          renderSectionHeader={({ section }) => (
            <SectionHeader
              title={section.title}
              action={
                section.key === 'confirm' && readyToConfirm.length >= 2 ? (
                  <Pressable
                    onPress={confirmAll}
                    disabled={confirmingAll}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        t.type.label,
                        {
                          color: t.color.accent,
                          fontWeight: '700',
                          opacity: confirmingAll ? 0.5 : 1,
                        },
                      ]}
                    >
                      {confirmingAll
                        ? tr('inbox.confirmingProgress', {
                            done: confirmProgress.done,
                            total: confirmProgress.total,
                          })
                        : tr('inbox.confirmAllCount', { count: readyToConfirm.length })}
                    </Text>
                  </Pressable>
                ) : undefined
              }
            />
          )}
          renderItem={({ item, section }) => {
            if (section.key === 'attention') {
              return (
                <AttentionCard
                  entry={item as AttentionItem}
                  onRetryError={retryError}
                  onDiscardError={discardError}
                  onRetryOp={retryOpNow}
                  onDiscardOp={discardOp}
                  onResolveConflict={resolveConflict}
                  onOpen={navigateOnce}
                />
              );
            }
            if (section.key === 'queued')
              return <QueuedCard change={item as QueuedChange} onOpen={navigateOnce} />;
            if (section.key === 'confirm') {
              const entry = item as ConfirmEntry;
              return (
                <Collapsible collapsed={leavingIds.has(entry.id)}>
                  <ConfirmCard
                    item={entry.item}
                    draft={entry.draft}
                    readiness={entry.readiness}
                    currencies={currencies}
                    onOpen={() => navigateOnce(`/draft/${entry.id}`)}
                    onConfirm={() => confirmSingle(entry.item)}
                    onDelete={() => deleteWithUndo([entry.id])}
                    selection={{
                      active: selecting,
                      selected: selectedIds.has(entry.id),
                      toggle: () => toggleSelected(entry.id),
                    }}
                  />
                </Collapsible>
              );
            }
            const row = item as InboxItemRow;
            if (section.key === 'review') {
              return (
                <ReviewCard
                  item={row}
                  currencies={currencies}
                  onApprove={() =>
                    reportErrors(
                      tr('inbox.approve'),
                      () => approveRecurringReview(db, row.id),
                      (message) => setSnackbar({ id: generateId(), message }),
                    )
                  }
                  onEdit={() => startEditReview(row)}
                  onDelete={() => discardReview(row.id)}
                />
              );
            }
            return null;
          }}
        />

        <CaptureDock />
        <Snackbar entry={snackbar} onDismiss={dismissSnackbar} />
      </View>

      <SyncSheet
        visible={syncSheetOpen}
        onClose={() => setSyncSheetOpen(false)}
        summary={summary}
        status={status}
        pendingOutboxCount={pendingOutboxCount}
        onSyncNow={() => syncNow()}
      />

      <Sheet
        visible={!!editingReview}
        onClose={() => setEditingReview(null)}
        title={tr('inbox.editReviewTitle')}
        footer={
          <Button
            title={savingReview ? tr('common.saving') : tr('inbox.saveAndApprove')}
            disabled={savingReview || !editAmountResult?.ok}
            onPress={saveEditReview}
          />
        }
      >
        {!!editingReview && (
          <>
            {editForeign && (
              <Text style={[t.type.body, { color: t.color.text }]}>
                {tr('inbox.chargedAs', {
                  amount: formatMoney(
                    editForeign.amount,
                    currencyOf(currencies, editForeign.currencyCode),
                  ),
                })}
              </Text>
            )}
            <TextField
              placeholder={`${tr('fields.amount')}, ${editCurrencyCode}`}
              value={editingReview.amount}
              keyboardType="decimal-pad"
              autoFocus={!!editForeign}
              invalid={editAmountInvalid}
              onChangeText={(v) => setEditingReview((cur) => (cur ? { ...cur, amount: v } : cur))}
            />
            {editAmountInvalid && (
              <Text style={[t.type.label, { color: t.color.danger }]}>
                {tr('common.invalidAmount')}
              </Text>
            )}
            <Button
              title={editAccount?.name ?? tr('fields.from')}
              variant="secondary"
              onPress={() => setPickingReviewAccount(true)}
            />
          </>
        )}
      </Sheet>
      <AccountPickerSheet
        visible={pickingReviewAccount}
        onClose={() => setPickingReviewAccount(false)}
        title={tr('fields.from')}
        accounts={assetAccounts}
        currencies={currencies}
        onSelect={(a) => setEditingReview((cur) => (cur ? { ...cur, accountId: a.id } : cur))}
      />
    </Screen>
  );
}
