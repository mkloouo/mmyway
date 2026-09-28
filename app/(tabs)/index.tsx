// Inbox (design §6.1) — the approval queue. Only ever holds unfinished work; confirmed/synced
// items leave every section (see src/inbox/useInboxSections.ts).
import { useEffect, useRef, useState } from 'react';
import { Pressable, SectionList, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, BarIconButton, SectionHeader, Card, Chip, Button, Money, StatusPill, EmptyState, Sheet, Pulse } from '../../src/ui/components';
import { CaptureDock } from '../../src/ui/CaptureDock';
import { SyncSheet } from '../../src/ui/SyncSheet';
import { SwipeableCard } from '../../src/ui/SwipeableCard';
import { haptics } from '../../src/ui/haptics';
import { Snackbar, type SnackbarEntry } from '../../src/ui/Snackbar';
import { relativeTime } from '../../src/ui/relativeTime';
import { currencyOf } from '../../src/ui/money';
import { categoryColor } from '../../src/ui/categoryColor';
import { useInboxSections, type AttentionItem, type InboxItemRow } from '../../src/inbox/useInboxSections';
import { draftReadiness } from '../../src/inbox/readiness';
import { confirmInboxItem, undoConfirm, type ConfirmResult } from '../../src/inbox/createManualEntry';
import { deleteInboxItem } from '../../src/inbox/updateDraft';
import { confirmDestructive } from '../../src/ui/confirm';
import { transition } from '../../src/inbox/state';
import { approveRecurringReview, editRecurringReview, deleteRecurringReview } from '../../src/sync/recurringReview';
import { discardOperation } from '../../src/sync/outbox';
import { requestSync } from '../../src/sync/syncTrigger';
import { parseDecimalInput } from '../../src/api/ff3/decimal';
import { reportErrors } from '../../src/ui/reportError';
import { useSync, useSignedIn, usePullToRefresh } from '../../src/sync/useSync';
import { inboxItems, outboxOperations, referenceCurrencies, cachedTransactions } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import { generateId } from '../../src/utils/id';
import type { Draft } from '../../src/inbox/draft';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { needsLabel } from '../../src/ui/readinessLabel';
import { appLocale } from '../../src/i18n';

type SectionKey = 'attention' | 'confirm' | 'review';
type SectionRow = AttentionItem | InboxItemRow;

function metaLine(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p).join(' · ');
}

// No swiping while selecting: a stray swipe mid-selection would confirm or delete one card.
function MaybeSwipeable({ disabled, children, ...props }: { disabled: boolean } & Parameters<typeof SwipeableCard>[0]) {
  return disabled ? <>{children}</> : <SwipeableCard {...props}>{children}</SwipeableCard>;
}

const UNDO_WINDOW_MS = 5000; // matches the Snackbar's visible time

function ConfirmCard({
  item, currencies, onOpen, onConfirm, onDelete, selection,
}: {
  item: InboxItemRow;
  currencies: { code: string; symbol: string; decimalPlaces: number }[];
  onOpen: () => void;
  onConfirm: () => void;
  onDelete: () => void;
  /** Multi-select: `active` while any card is selected; a tap toggles instead of opening. */
  selection: { active: boolean; selected: boolean; toggle: () => void };
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const cardStyle = { marginHorizontal: t.space.lg, marginBottom: t.space.sm };
  const press = selection.active ? selection.toggle : onOpen;

  if (item.kind === 'receipt' && item.state === 'captured') {
    return (
      <MaybeSwipeable disabled={selection.active} onDelete={onDelete}>
        <Card onPress={press} onLongPress={selection.toggle} selected={selection.selected} style={cardStyle}>
          <Pulse active>
            <Text style={[t.type.body, { color: t.color.textMuted }]}>▦ {tr('inbox.readingReceipt')}</Text>
          </Pulse>
        </Card>
      </MaybeSwipeable>
    );
  }

  const draft: Draft = JSON.parse(item.draftJson);
  const readiness = draftReadiness(draft);
  const isTransfer = draft.type === 'transfer';
  const payeeName = isTransfer
    ? `${draft.sourceName ?? '?'} → ${draft.destinationName ?? '?'}`
    : (draft.type === 'deposit' ? draft.sourceName : draft.destinationName) || draft.description;
  const accountName = draft.type === 'deposit' ? draft.destinationName : draft.sourceName;
  const time = new Date(draft.date).toLocaleTimeString(appLocale(), { hour: '2-digit', minute: '2-digit' });
  const meta = isTransfer ? metaLine([time]) : metaLine([draft.categoryName, accountName, time]);
  const dotColor = draft.categoryName ? categoryColor(draft.categoryName, t.dark) : t.color.textFaint;

  const badges: { label: string; tone?: 'warn' }[] = [];
  if (draft.isNewPayee && !isTransfer) badges.push({ label: tr('inbox.newPayee'), tone: 'warn' });
  if (!readiness.ready) badges.push({ label: needsLabel(readiness.missing), tone: 'warn' });
  if (draft.sharedWith) badges.push({ label: tr('inbox.sharedWith', { name: draft.sharedWith }) });
  // Handed back by the outbox: something it points at was deleted in FF3 (src/sync/outbox.ts).
  if (item.errorMessage) badges.push({ label: item.errorMessage, tone: 'warn' });

  return (
    <MaybeSwipeable disabled={selection.active} onConfirm={onConfirm} onDelete={onDelete} confirmEnabled={readiness.ready} onRefused={haptics.warn}>
      <Card onPress={press} onLongPress={selection.toggle} selected={selection.selected} style={cardStyle}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
          <Text style={[t.type.heading, { color: t.color.text, flex: 1 }]} numberOfLines={1}>{payeeName}</Text>
          <Money amount={draft.amount || '0'} currency={currencyOf(currencies, draft.currencyCode)} type={draft.type} size="heading" />
        </View>
        {!!meta && <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>{meta}</Text>}
        {/* Badges and the ✓ share one footer row: the button sits level with "New payee"
            instead of on a line of its own under it. */}
        {(badges.length > 0 || (readiness.ready && !selection.active)) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, marginTop: t.space.sm }}>
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
              {badges.map((b) => <Chip key={b.label} label={b.label} tone={b.tone} />)}
            </View>
            {readiness.ready && !selection.active && (
              <Pressable
                onPress={onConfirm}
                accessibilityRole="button"
                accessibilityLabel={tr('inbox.confirm')}
                hitSlop={8}
                style={({ pressed }) => ({
                  width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: t.color.accentSoft, opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name="checkmark" size={20} color={t.color.accent} />
              </Pressable>
            )}
          </View>
        )}
      </Card>
    </MaybeSwipeable>
  );
}

function ReviewCard({
  item, currencies, onApprove, onEdit, onDelete,
}: {
  item: InboxItemRow;
  currencies: { code: string; symbol: string; decimalPlaces: number }[];
  onApprove: () => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [approving, setApproving] = useState(false);
  const journal = JSON.parse(item.draftJson);
  const dateLabel = journal.date ? new Date(journal.date).toLocaleDateString(appLocale(), { day: 'numeric', month: 'short' }) : undefined;

  async function approve() {
    if (approving) return;
    setApproving(true);
    try {
      await onApprove();
    } finally {
      setApproving(false);
    }
  }

  return (
    <Card style={{ marginHorizontal: t.space.lg, marginBottom: t.space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        <Ionicons name="repeat" size={16} color={t.color.textMuted} />
        <Text style={[t.type.heading, { color: t.color.text, flex: 1 }]} numberOfLines={1}>{journal.description}</Text>
        <Money amount={journal.amount ?? '0'} currency={currencyOf(currencies, journal.currency_code ?? '')} type="withdrawal" size="heading" />
      </View>
      <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>
        {metaLine([journal.source_name, dateLabel, tr('inbox.recurring')])}
      </Text>
      <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: t.space.sm }}>
        <Button title={approving ? tr('inbox.approving') : tr('inbox.approve')} variant="secondary" onPress={approve} disabled={approving} style={{ flex: 1 }} />
        <Button title={tr('common.edit')} variant="ghost" onPress={onEdit} disabled={approving} style={{ flex: 1 }} />
        <Button title={tr('common.delete')} variant="danger" onPress={onDelete} disabled={approving} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

function AttentionCard({
  entry, onRetryError, onDiscardError, onRetryOp, onDiscardOp, onResolveConflict,
}: {
  entry: AttentionItem;
  onRetryError: (id: string) => void;
  onDiscardError: (id: string) => void;
  onRetryOp: (id: string) => void;
  onDiscardOp: (id: string) => void;
  onResolveConflict: (groupId: string) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const cardStyle = { marginHorizontal: t.space.lg, marginBottom: t.space.sm };

  if (entry.kind === 'inbox_error') {
    const draft: Partial<Draft> = JSON.parse(entry.item.draftJson || '{}');
    const label = draft.description || draft.destinationName || draft.sourceName || tr('inbox.item');
    return (
      <Card style={cardStyle}>
        <Text style={[t.type.heading, { color: t.color.danger }]}>✕ {label}</Text>
        <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]} numberOfLines={2}>
          {entry.item.errorMessage ?? tr('inbox.failed')}
        </Text>
        <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: t.space.sm }}>
          <Button title={tr('inbox.retry')} variant="secondary" onPress={() => onRetryError(entry.item.id)} style={{ flex: 1 }} />
          <Button title={tr('inbox.discard')} variant="danger" onPress={() => onDiscardError(entry.item.id)} style={{ flex: 1 }} />
        </View>
      </Card>
    );
  }

  const op = entry.op;
  const isConflict = op.lastError === 'conflict';
  let groupId: string | undefined;
  try { groupId = JSON.parse(op.payloadJson).groupId; } catch { groupId = undefined; }

  return (
    <Card style={cardStyle}>
      <Text style={[t.type.heading, { color: t.color.danger }]}>
        ✕ {isConflict ? tr('inbox.conflict') : tr('inbox.operationFailed', { kind: op.kind.replace(/_/g, ' ') })}
      </Text>
      <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]} numberOfLines={2}>
        {op.lastError ?? tr('inbox.unknownError')}
      </Text>
      <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: t.space.sm }}>
        {isConflict && groupId ? (
          <Button title={tr('inbox.resolve')} variant="secondary" onPress={() => onResolveConflict(groupId!)} style={{ flex: 1 }} />
        ) : (
          <>
            <Button title={tr('inbox.retryNow')} variant="secondary" onPress={() => onRetryOp(op.id)} style={{ flex: 1 }} />
            <Button title={tr('inbox.discard')} variant="danger" onPress={() => onDiscardOp(op.id)} style={{ flex: 1 }} />
          </>
        )}
      </View>
    </Card>
  );
}

export default function InboxScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { needsAttention, toConfirm, toReview } = useInboxSections();
  const { data: outbox } = useLiveQuery(db.select().from(outboxOperations));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  // Just "has anything ever synced" — .limit(1) instead of loading the whole cached table.
  const { data: cachedTxProbe } = useLiveQuery(db.select({ id: cachedTransactions.groupId }).from(cachedTransactions).limit(1));
  const { status, summary, syncNow } = useSync();
  const pull = usePullToRefresh();

  const assetAccounts = useAssetAccounts() ?? [];
  const pendingOutboxCount = (outbox ?? []).filter((op) => op.status === 'pending' || op.status === 'failed').length;

  // A sync that clears the queue gets a success haptic (design §3.4) — adjusted during render
  // (React's pattern for reacting to a derived value changing), not in an effect.
  const [prevPendingOutboxCount, setPrevPendingOutboxCount] = useState(pendingOutboxCount);
  if (pendingOutboxCount !== prevPendingOutboxCount) {
    if (prevPendingOutboxCount > 0 && pendingOutboxCount === 0) haptics.success();
    setPrevPendingOutboxCount(pendingOutboxCount);
  }

  const hasCredentials = useSignedIn();

  const [syncSheetOpen, setSyncSheetOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<SnackbarEntry | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [confirmProgress, setConfirmProgress] = useState({ done: 0, total: 0 });
  const [editingReview, setEditingReview] = useState<{ id: string; amount: string; currencyCode: string; accountId: string | null } | null>(null);
  const [savingReview, setSavingReview] = useState(false);

  // Multi-select (long-press a card): bulk confirm or delete.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selecting = selectedIds.size > 0;
  function toggleSelected(id: string) {
    haptics.tick();
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // A swiped-away draft disappears at once and is only really deleted after its Undo window —
  // the swipe used to stop on a confirmation dialog.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const deleteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = deleteTimers.current;
    // Leaving the screen commits whatever is still waiting.
    return () => { for (const [id, timer] of timers) { clearTimeout(timer); void deleteInboxItem(db, id); } timers.clear(); };
  }, [db]);
  function deleteWithUndo(ids: string[]) {
    setHiddenIds((cur) => new Set([...cur, ...ids]));
    for (const id of ids) {
      deleteTimers.current.set(id, setTimeout(() => {
        deleteTimers.current.delete(id);
        void deleteInboxItem(db, id);
      }, UNDO_WINDOW_MS));
    }
    haptics.tick();
    setSnackbar({
      id: generateId(),
      message: ids.length > 1 ? tr('inbox.deletedCount', { count: ids.length }) : tr('inbox.deleted'),
      actionLabel: tr('common.undo'),
      onAction: () => {
        for (const id of ids) { clearTimeout(deleteTimers.current.get(id)); deleteTimers.current.delete(id); }
        setHiddenIds((cur) => new Set([...cur].filter((id) => !ids.includes(id))));
      },
    });
  }

  function showConfirmedSnackbar(batch: { id: string; result: ConfirmResult }[]) {
    setSnackbar({
      id: generateId(),
      message: batch.length > 1 ? tr('inbox.confirmedCount', { count: batch.length }) : tr('inbox.confirmed'),
      actionLabel: tr('common.undo'),
      onAction: async () => {
        const outcomes = await Promise.all(batch.map(({ id, result }) => undoConfirm(db, id, result)));
        setSnackbar({
          id: generateId(),
          message: outcomes.includes('already_sent') ? tr('inbox.alreadySent') : tr('inbox.undone'),
        });
      },
    });
  }

  async function confirmSingle(item: InboxItemRow) {
    await reportErrors(tr('inbox.confirm'), async () => {
      const result = await confirmInboxItem(db, item.id);
      haptics.tick();
      showConfirmedSnackbar([{ id: item.id, result }]);
    }, (message) => setSnackbar({ id: generateId(), message }));
  }

  const visibleToConfirm = toConfirm.filter((item) => !hiddenIds.has(item.id));
  const readyToConfirm = visibleToConfirm.filter((item) => {
    if (item.kind === 'receipt' && item.state === 'captured') return false;
    return draftReadiness(JSON.parse(item.draftJson)).ready;
  });

  async function confirmAll() {
    if (confirmingAll || readyToConfirm.length < 2) return;
    setConfirmingAll(true);
    setConfirmProgress({ done: 0, total: readyToConfirm.length });
    const batch: { id: string; result: ConfirmResult }[] = [];
    let failed = false;
    try {
      await reportErrors(tr('inbox.confirmAll'), async () => {
        for (const item of readyToConfirm) {
          const result = await confirmInboxItem(db, item.id);
          batch.push({ id: item.id, result });
          setConfirmProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      }, (message) => {
        failed = true;
        setSnackbar({ id: generateId(), message: batch.length > 0 ? tr('inbox.failedAfter', { message, count: batch.length }) : message });
      });
    } finally {
      setConfirmingAll(false);
    }
    if (failed || batch.length === 0) return;
    haptics.tick();
    showConfirmedSnackbar(batch);
  }

  async function retryError(id: string) {
    await db.update(inboxItems)
      .set({ state: transition('error', 'retry'), errorMessage: null, updatedAt: new Date().toISOString() })
      .where(eq(inboxItems.id, id));
    // A retried receipt is re-read by the sync; don't make it wait for the next app resume.
    requestSync();
  }
  async function discardError(id: string) {
    if (!await confirmDestructive(tr('inbox.discardItemTitle'), tr('inbox.discard'), tr('inbox.discardItemBody'))) return;
    await deleteInboxItem(db, id);
  }
  async function deleteSelected() {
    const ids = [...selectedIds];
    setSelectedIds(new Set());
    deleteWithUndo(ids);
  }
  async function confirmSelected() {
    const ready = visibleToConfirm.filter((item) => selectedIds.has(item.id) && !(item.kind === 'receipt' && item.state === 'captured') && draftReadiness(JSON.parse(item.draftJson)).ready);
    setSelectedIds(new Set());
    if (ready.length === 0) { haptics.warn(); return; }
    const batch: { id: string; result: ConfirmResult }[] = [];
    await reportErrors(tr('inbox.confirm'), async () => {
      for (const item of ready) batch.push({ id: item.id, result: await confirmInboxItem(db, item.id) });
    }, (message) => setSnackbar({ id: generateId(), message }));
    if (batch.length > 0) { haptics.tick(); showConfirmedSnackbar(batch); }
  }
  async function discardReview(id: string) {
    if (!await confirmDestructive(tr('inbox.deleteReviewTitle'), tr('common.delete'), tr('inbox.deleteReviewBody'))) return;
    await deleteRecurringReview(db, id);
  }
  async function retryOpNow(opId: string) {
    await db.update(outboxOperations).set({ status: 'pending', lastError: null, nextAttemptAt: null }).where(eq(outboxOperations.id, opId));
    syncNow();
  }
  async function discardOp(opId: string) {
    if (!await confirmDestructive(tr('inbox.discardChangeTitle'), tr('inbox.discard'), tr('inbox.discardChangeBody'))) return;
    await discardOperation(db, opId);
  }
  function resolveConflict(groupId: string) {
    navigateOnce(`/transactions/${groupId}`);
  }

  function startEditReview(item: InboxItemRow) {
    const journal = JSON.parse(item.draftJson);
    setEditingReview({ id: item.id, amount: journal.amount ?? '', currencyCode: journal.currency_code ?? '', accountId: journal.source_id ?? null });
  }
  const editAmountResult = editingReview ? parseDecimalInput(editingReview.amount) : null;
  const editAmountInvalid = !!editAmountResult && !editAmountResult.ok;
  // A double-tap here used to enqueue two recurring_review operations.
  async function saveEditReview() {
    if (!editingReview || savingReview || !editAmountResult?.ok) return;
    setSavingReview(true);
    try {
      await reportErrors(tr('common.save'), async () => {
        await editRecurringReview(db, editingReview.id, {
          amount: editAmountResult.value,
          currency_code: editingReview.currencyCode,
          ...(editingReview.accountId ? { source_id: editingReview.accountId } : {}),
        });
        setEditingReview(null);
      }, (message) => setSnackbar({ id: generateId(), message }));
    } finally {
      setSavingReview(false);
    }
  }

  const allSections: { key: SectionKey; title: string; data: SectionRow[] }[] = [
    { key: 'attention', title: tr('inbox.sectionAttention'), data: needsAttention },
    { key: 'confirm', title: tr('inbox.sectionConfirm'), data: visibleToConfirm },
    { key: 'review', title: tr('inbox.sectionReview'), data: toReview },
  ];
  const sections = allSections.filter((s) => s.data.length > 0);

  const pillState: 'ok' | 'syncing' | 'queued' | 'offline' | 'error' = status === 'syncing' ? 'syncing'
    : hasCredentials === false ? 'offline'
    : summary?.error ? 'error'
    : summary && !summary.ff3Reachable ? 'offline'
    : pendingOutboxCount > 0 ? 'queued'
    : 'ok';
  const pillLabel = status === 'syncing' ? tr('sync.syncing')
    : hasCredentials === false ? tr('sync.notSignedIn')
    : summary?.error ? tr('sync.error')
    : summary && !summary.ff3Reachable ? tr('sync.offline')
    : pendingOutboxCount > 0 ? tr('sync.queued', { count: pendingOutboxCount })
    : relativeTime(summary?.lastSyncedAt);

  const subtitleParts: string[] = [];
  if (toConfirm.length > 0) subtitleParts.push(tr('inbox.toConfirmCount', { count: toConfirm.length }));
  if (toReview.length > 0) subtitleParts.push(tr('inbox.toReviewCount', { count: toReview.length }));
  const dateTitle = new Date().toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric', month: 'short' });

  const showOfflineBanner = hasCredentials === true && summary && !summary.ff3Reachable && pendingOutboxCount > 0;
  // undefined until the first read lands, so a synced-but-empty Inbox doesn't flash "Nothing
  // synced yet" before flipping to "Inbox zero" once the probe resolves.
  const hasSyncedBefore = cachedTxProbe === undefined ? undefined : cachedTxProbe.length > 0;

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {selecting ? (
          <AppBar
            title={tr('inbox.selected', { count: selectedIds.size })}
            left={<BarIconButton icon="close" label={tr('inbox.cancelSelection')} onPress={() => setSelectedIds(new Set())} />}
            right={(
              <>
                <Button title={tr('inbox.confirm')} variant="secondary" size="bar" onPress={confirmSelected} />
                <Button title={tr('common.delete')} variant="danger" size="bar" onPress={deleteSelected} />
              </>
            )}
          />
        ) : (
        <AppBar
          title={dateTitle}
          subtitle={subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined}
          right={(
            <Pressable onPress={() => setSyncSheetOpen(true)} accessibilityRole="button" accessibilityLabel={tr('sync.statusLabel')}>
              <StatusPill state={pillState} label={pillLabel} />
            </Pressable>
          )}
        />
        )}
        {!!showOfflineBanner && (
          <View style={{ backgroundColor: t.color.warnSoft, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.warn }]}>⚑ {tr('inbox.offlineBanner', { count: pendingOutboxCount })}</Text>
          </View>
        )}

        {/* Always mounted (empty states go in ListEmptyComponent) so pull-to-refresh works on an
            empty Inbox too. */}
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.id}
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          contentContainerStyle={{ paddingBottom: 140 }}
          ListEmptyComponent={(
            <>
              {hasCredentials === false && (
                <EmptyState
                  glyph="⚡"
                  title={tr('inbox.connectTitle')}
                  hint={tr('inbox.connectHint')}
                  action={<Button title={tr('inbox.goToSettings')} onPress={() => navigateOnce('/settings')} />}
                />
              )}
              {hasCredentials === true && hasSyncedBefore === false && (
                <EmptyState glyph="↻" title={tr('inbox.nothingSyncedTitle')} hint={tr('inbox.nothingSyncedHint')} />
              )}
              {hasCredentials === true && hasSyncedBefore === true && (
                <EmptyState
                  glyph="✓"
                  title={tr('inbox.zeroTitle')}
                  hint={tr('inbox.zeroHint')}
                  action={(
                    <View style={{ flexDirection: 'row', gap: t.space.md }}>
                      <Button title={`＋ ${tr('common.add')}`} onPress={() => navigateOnce('/capture')} />
                      <Button title="📷" variant="secondary" onPress={() => navigateOnce('/receipt')} />
                    </View>
                  )}
                />
              )}
            </>
          )}
          renderSectionHeader={({ section }) => (
            <SectionHeader
              title={section.title}
              action={section.key === 'confirm' && readyToConfirm.length >= 2 ? (
                <Pressable onPress={confirmAll} disabled={confirmingAll} accessibilityRole="button">
                  <Text style={[t.type.label, { color: t.color.accent, fontWeight: '700', opacity: confirmingAll ? 0.5 : 1 }]}>
                    {confirmingAll ? tr('inbox.confirmingProgress', { done: confirmProgress.done, total: confirmProgress.total }) : tr('inbox.confirmAllCount', { count: readyToConfirm.length })}
                  </Text>
                </Pressable>
              ) : undefined}
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
                />
              );
            }
            const row = item as InboxItemRow;
            if (section.key === 'review') {
              return (
                <ReviewCard
                  item={row}
                  currencies={currencies ?? []}
                  onApprove={() => reportErrors(tr('inbox.approve'), () => approveRecurringReview(db, row.id), (message) => setSnackbar({ id: generateId(), message }))}
                  onEdit={() => startEditReview(row)}
                  onDelete={() => discardReview(row.id)}
                />
              );
            }
            return (
              <ConfirmCard
                item={row}
                currencies={currencies ?? []}
                onOpen={() => navigateOnce(`/draft/${row.id}`)}
                onConfirm={() => confirmSingle(row)}
                onDelete={() => deleteWithUndo([row.id])}
                selection={{ active: selecting, selected: selectedIds.has(row.id), toggle: () => toggleSelected(row.id) }}
              />
            );
          }}
        />

        <CaptureDock />
        <Snackbar entry={snackbar} onDismiss={() => setSnackbar(null)} />
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
        footer={<Button title={savingReview ? tr('common.saving') : tr('inbox.saveAndApprove')} disabled={savingReview || editAmountInvalid} onPress={saveEditReview} />}
      >
        {!!editingReview && (
          <>
            <TextInput
              placeholder={tr('fields.amount')} value={editingReview.amount} keyboardType="decimal-pad"
              onChangeText={(v) => setEditingReview((cur) => (cur ? { ...cur, amount: v } : cur))}
              style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text }}
              placeholderTextColor={t.color.textFaint}
            />
            {editAmountInvalid && (
              <Text style={[t.type.label, { color: t.color.danger }]}>{tr('common.invalidAmount')}</Text>
            )}
            <TextInput
              placeholder={tr('fields.currency')} value={editingReview.currencyCode}
              onChangeText={(v) => setEditingReview((cur) => (cur ? { ...cur, currencyCode: v } : cur))}
              style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text }}
              placeholderTextColor={t.color.textFaint}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
              {assetAccounts.map((a) => (
                <Chip
                  key={a.id}
                  label={a.name}
                  selected={a.id === editingReview.accountId}
                  onPress={() => setEditingReview((cur) => (cur ? { ...cur, accountId: a.id } : cur))}
                />
              ))}
            </View>
          </>
        )}
      </Sheet>
    </Screen>
  );
}
