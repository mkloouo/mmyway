// Inbox (design §6.1) — the approval queue. Only ever holds unfinished work; confirmed/synced
// items leave every section (see src/inbox/useInboxSections.ts).
import { useState } from 'react';
import { Pressable, SectionList, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, SectionHeader, Card, Chip, Button, Money, StatusPill, EmptyState, Sheet, Pulse } from '../../src/ui/components';
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
import { useSync, useSignedIn } from '../../src/sync/useSync';
import { inboxItems, outboxOperations, referenceAccounts, referenceCurrencies, cachedTransactions } from '../../src/db/schema';
import { generateId } from '../../src/utils/id';
import type { Draft } from '../../src/inbox/draft';

type SectionKey = 'attention' | 'confirm' | 'review';
type SectionRow = AttentionItem | InboxItemRow;

function metaLine(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p).join(' · ');
}

function ConfirmCard({
  item, currencies, onOpen, onConfirm, onDelete,
}: {
  item: InboxItemRow;
  currencies: { code: string; symbol: string; decimalPlaces: number }[];
  onOpen: () => void;
  onConfirm: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();

  if (item.kind === 'receipt' && item.state === 'captured') {
    return (
      <SwipeableCard onDelete={onDelete}>
        <Card onPress={onOpen} style={{ marginHorizontal: t.space.lg, marginBottom: t.space.sm }}>
          <Pulse active>
            <Text style={[t.type.body, { color: t.color.textMuted }]}>▦ Reading receipt…</Text>
          </Pulse>
        </Card>
      </SwipeableCard>
    );
  }

  const draft: Draft = JSON.parse(item.draftJson);
  const readiness = draftReadiness(draft);
  const isTransfer = draft.type === 'transfer';
  const payeeName = isTransfer
    ? `${draft.sourceName ?? '?'} → ${draft.destinationName ?? '?'}`
    : (draft.type === 'deposit' ? draft.sourceName : draft.destinationName) || draft.description;
  const accountName = draft.type === 'deposit' ? draft.destinationName : draft.sourceName;
  const time = new Date(draft.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const meta = isTransfer ? metaLine([time]) : metaLine([draft.categoryName, accountName, time]);
  const dotColor = draft.categoryName ? categoryColor(draft.categoryName, t.dark) : t.color.textFaint;

  const badges: { label: string; tone?: 'warn' }[] = [];
  if (draft.isNewPayee && !isTransfer) badges.push({ label: 'New payee', tone: 'warn' });
  if (!readiness.ready) badges.push({ label: `Needs ${readiness.missing.join(', ')}`, tone: 'warn' });
  if (draft.sharedWith) badges.push({ label: `Shared with ${draft.sharedWith}` });

  return (
    <SwipeableCard onConfirm={onConfirm} onDelete={onDelete} confirmEnabled={readiness.ready} onRefused={haptics.warn}>
      <Card onPress={onOpen} style={{ marginHorizontal: t.space.lg, marginBottom: t.space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
          <Text style={[t.type.heading, { color: t.color.text, flex: 1 }]} numberOfLines={1}>{payeeName}</Text>
          <Money amount={draft.amount || '0'} currency={currencyOf(currencies, draft.currencyCode)} type={draft.type} size="heading" />
        </View>
        {!!meta && <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>{meta}</Text>}
        {badges.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm, marginTop: t.space.sm }}>
            {badges.map((b) => <Chip key={b.label} label={b.label} tone={b.tone} />)}
          </View>
        )}
        {readiness.ready && (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: t.space.sm }}>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel="Confirm"
              style={({ pressed }) => ({
                width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                backgroundColor: t.color.accentSoft, opacity: pressed ? 0.6 : 1,
              })}
            >
              <Ionicons name="checkmark" size={20} color={t.color.accent} />
            </Pressable>
          </View>
        )}
      </Card>
    </SwipeableCard>
  );
}

function ReviewCard({
  item, currencies, onApprove, onEdit, onDelete,
}: {
  item: InboxItemRow;
  currencies: { code: string; symbol: string; decimalPlaces: number }[];
  onApprove: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  const journal = JSON.parse(item.draftJson);
  const dateLabel = journal.date ? new Date(journal.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : undefined;

  return (
    <Card style={{ marginHorizontal: t.space.lg, marginBottom: t.space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        <Ionicons name="repeat" size={16} color={t.color.textMuted} />
        <Text style={[t.type.heading, { color: t.color.text, flex: 1 }]} numberOfLines={1}>{journal.description}</Text>
        <Money amount={journal.amount ?? '0'} currency={currencyOf(currencies, journal.currency_code ?? '')} type="withdrawal" size="heading" />
      </View>
      <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>
        {metaLine([journal.source_name, dateLabel, 'recurring'])}
      </Text>
      <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: t.space.sm }}>
        <Button title="Approve" variant="secondary" onPress={onApprove} style={{ flex: 1 }} />
        <Button title="Edit" variant="ghost" onPress={onEdit} style={{ flex: 1 }} />
        <Button title="Delete" variant="danger" onPress={onDelete} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

function AttentionCard({
  entry, onRetryError, onDiscardError, onRetryOp, onResolveConflict,
}: {
  entry: AttentionItem;
  onRetryError: (id: string) => void;
  onDiscardError: (id: string) => void;
  onRetryOp: (id: string) => void;
  onResolveConflict: (groupId: string) => void;
}) {
  const t = useTheme();
  const cardStyle = { marginHorizontal: t.space.lg, marginBottom: t.space.sm };

  if (entry.kind === 'inbox_error') {
    const draft: Partial<Draft> = JSON.parse(entry.item.draftJson || '{}');
    const label = draft.description || draft.destinationName || draft.sourceName || 'Item';
    return (
      <Card style={cardStyle}>
        <Text style={[t.type.heading, { color: t.color.danger }]}>✕ {label}</Text>
        <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]} numberOfLines={2}>
          {entry.item.errorMessage ?? 'Failed'}
        </Text>
        <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: t.space.sm }}>
          <Button title="Retry" variant="secondary" onPress={() => onRetryError(entry.item.id)} style={{ flex: 1 }} />
          <Button title="Discard" variant="danger" onPress={() => onDiscardError(entry.item.id)} style={{ flex: 1 }} />
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
        ✕ {isConflict ? 'Conflict' : `${op.kind.replace(/_/g, ' ')} failed`}
      </Text>
      <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]} numberOfLines={2}>
        {op.lastError ?? 'Unknown error'}
      </Text>
      <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: t.space.sm }}>
        {isConflict && groupId
          ? <Button title="Resolve ›" variant="secondary" onPress={() => onResolveConflict(groupId!)} style={{ flex: 1 }} />
          : <Button title="Retry now" variant="secondary" onPress={() => onRetryOp(op.id)} style={{ flex: 1 }} />}
      </View>
    </Card>
  );
}

export default function InboxScreen() {
  const db = useDb();
  const t = useTheme();
  const { needsAttention, toConfirm, toReview } = useInboxSections();
  const { data: outbox } = useLiveQuery(db.select().from(outboxOperations));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const { data: assetAccountRows } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: cachedTxRows } = useLiveQuery(db.select().from(cachedTransactions));
  const { status, summary, syncNow } = useSync();

  const assetAccounts = (assetAccountRows ?? []).filter((a) => a.type === 'asset');
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

  function showConfirmedSnackbar(batch: { id: string; result: ConfirmResult }[]) {
    setSnackbar({
      id: generateId(),
      message: batch.length > 1 ? `Confirmed ${batch.length}` : 'Confirmed',
      actionLabel: 'Undo',
      onAction: async () => {
        const outcomes = await Promise.all(batch.map(({ id, result }) => undoConfirm(db, id, result)));
        setSnackbar({
          id: generateId(),
          message: outcomes.includes('already_sent') ? 'Already sent' : 'Undone',
        });
      },
    });
  }

  async function confirmSingle(item: InboxItemRow) {
    const result = await confirmInboxItem(db, item.id);
    haptics.tick();
    showConfirmedSnackbar([{ id: item.id, result }]);
  }

  const readyToConfirm = toConfirm.filter((item) => {
    if (item.kind === 'receipt' && item.state === 'captured') return false;
    return draftReadiness(JSON.parse(item.draftJson)).ready;
  });

  async function confirmAll() {
    if (confirmingAll || readyToConfirm.length < 2) return;
    setConfirmingAll(true);
    setConfirmProgress({ done: 0, total: readyToConfirm.length });
    const batch: { id: string; result: ConfirmResult }[] = [];
    try {
      for (const item of readyToConfirm) {
        const result = await confirmInboxItem(db, item.id);
        batch.push({ id: item.id, result });
        setConfirmProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    } finally {
      setConfirmingAll(false);
    }
    haptics.tick();
    showConfirmedSnackbar(batch);
  }

  async function retryError(id: string) {
    await db.update(inboxItems)
      .set({ state: transition('error', 'retry'), errorMessage: null, updatedAt: new Date().toISOString() })
      .where(eq(inboxItems.id, id));
  }
  async function discardError(id: string) {
    if (!await confirmDestructive('Discard this item?', 'Discard', 'It is removed from the Inbox and never sent.')) return;
    await deleteInboxItem(db, id);
  }
  // Both the card's ✕ and a completed left-swipe land here, so the confirmation covers both —
  // the swipe used to delete outright, with no confirm and no undo.
  async function discardDraft(id: string) {
    if (!await confirmDestructive('Delete this entry?', 'Delete')) return;
    await deleteInboxItem(db, id);
  }
  async function discardReview(id: string) {
    if (!await confirmDestructive('Delete this recurring review?', 'Delete', 'The recurring transaction itself stays in Firefly III.')) return;
    await deleteRecurringReview(db, id);
  }
  async function retryOpNow(opId: string) {
    await db.update(outboxOperations).set({ status: 'pending', lastError: null }).where(eq(outboxOperations.id, opId));
    syncNow();
  }
  function resolveConflict(groupId: string) {
    router.push(`/transactions/${groupId}`);
  }

  function startEditReview(item: InboxItemRow) {
    const journal = JSON.parse(item.draftJson);
    setEditingReview({ id: item.id, amount: journal.amount ?? '', currencyCode: journal.currency_code ?? '', accountId: journal.source_id ?? null });
  }
  // A double-tap here used to enqueue two recurring_review operations.
  async function saveEditReview() {
    if (!editingReview || savingReview) return;
    setSavingReview(true);
    try {
      await editRecurringReview(db, editingReview.id, {
        amount: editingReview.amount,
        currency_code: editingReview.currencyCode,
        ...(editingReview.accountId ? { source_id: editingReview.accountId } : {}),
      });
      setEditingReview(null);
    } finally {
      setSavingReview(false);
    }
  }

  const allSections: { key: SectionKey; title: string; data: SectionRow[] }[] = [
    { key: 'attention', title: 'NEEDS ATTENTION', data: needsAttention },
    { key: 'confirm', title: 'TO CONFIRM', data: toConfirm },
    { key: 'review', title: 'TO REVIEW', data: toReview },
  ];
  const sections = allSections.filter((s) => s.data.length > 0);

  const pillState: 'ok' | 'syncing' | 'queued' | 'offline' | 'error' = status === 'syncing' ? 'syncing'
    : hasCredentials === false ? 'offline'
    : summary?.error ? 'error'
    : summary && !summary.ff3Reachable ? 'offline'
    : pendingOutboxCount > 0 ? 'queued'
    : 'ok';
  const pillLabel = status === 'syncing' ? 'Syncing…'
    : hasCredentials === false ? 'Not signed in'
    : summary?.error ? 'Sync error'
    : summary && !summary.ff3Reachable ? 'Offline'
    : pendingOutboxCount > 0 ? `Queued ${pendingOutboxCount}`
    : relativeTime(summary?.lastSyncedAt);

  const subtitleParts: string[] = [];
  if (toConfirm.length > 0) subtitleParts.push(`${toConfirm.length} to confirm`);
  if (toReview.length > 0) subtitleParts.push(`${toReview.length} to review`);
  const dateTitle = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

  const showOfflineBanner = hasCredentials === true && summary && !summary.ff3Reachable && pendingOutboxCount > 0;
  const hasSyncedBefore = (cachedTxRows ?? []).length > 0;

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <AppBar
          title={dateTitle}
          subtitle={subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined}
          right={(
            <Pressable onPress={() => setSyncSheetOpen(true)} accessibilityRole="button" accessibilityLabel="Sync status">
              <StatusPill state={pillState} label={pillLabel} />
            </Pressable>
          )}
        />
        {!!showOfflineBanner && (
          <View style={{ backgroundColor: t.color.warnSoft, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.warn }]}>⚑ Offline — {pendingOutboxCount} queued, will send later</Text>
          </View>
        )}

        {/* Always mounted (empty states go in ListEmptyComponent) so pull-to-refresh works on an
            empty Inbox too. */}
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.id}
          refreshing={status === 'syncing'}
          onRefresh={syncNow}
          contentContainerStyle={{ paddingBottom: 140 }}
          ListEmptyComponent={(
            <>
              {hasCredentials === false && (
                <EmptyState
                  glyph="⚡"
                  title="Connect Firefly III"
                  hint="Sign in to start capturing entries."
                  action={<Button title="Go to Settings" onPress={() => router.push('/settings')} />}
                />
              )}
              {hasCredentials === true && !hasSyncedBefore && (
                <EmptyState glyph="↻" title="Nothing synced yet" hint="Pull to refresh." />
              )}
              {hasCredentials === true && hasSyncedBefore && (
                <EmptyState
                  glyph="✓"
                  title="Inbox zero"
                  hint="Nothing waiting to confirm."
                  action={(
                    <View style={{ flexDirection: 'row', gap: t.space.md }}>
                      <Button title="＋ Add" onPress={() => router.push('/capture')} />
                      <Button title="📷" variant="secondary" onPress={() => router.push('/receipt')} />
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
                    {confirmingAll ? `Confirming ${confirmProgress.done}/${confirmProgress.total}` : `Confirm all (${readyToConfirm.length})`}
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
                  onApprove={() => approveRecurringReview(db, row.id)}
                  onEdit={() => startEditReview(row)}
                  onDelete={() => discardReview(row.id)}
                />
              );
            }
            return (
              <ConfirmCard
                item={row}
                currencies={currencies ?? []}
                onOpen={() => router.push(`/draft/${row.id}`)}
                onConfirm={() => confirmSingle(row)}
                onDelete={() => discardDraft(row.id)}
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
        title="Edit recurring transaction"
        footer={<Button title={savingReview ? 'Saving…' : 'Save & approve'} disabled={savingReview} onPress={saveEditReview} />}
      >
        {!!editingReview && (
          <>
            <TextInput
              placeholder="Amount" value={editingReview.amount} keyboardType="decimal-pad"
              onChangeText={(v) => setEditingReview((cur) => (cur ? { ...cur, amount: v } : cur))}
              style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text }}
              placeholderTextColor={t.color.textFaint}
            />
            <TextInput
              placeholder="Currency" value={editingReview.currencyCode}
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
