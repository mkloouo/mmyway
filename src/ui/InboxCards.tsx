// The Inbox's three card kinds (design §6.1): a draft to confirm, a recurring transaction to
// review, and something that needs attention (an errored item or a failed queued change).
import { useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { usePopOnChange } from './feedback';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from './theme';
import { Card, Chip, Button, Money, Pulse } from './components';
import { SwipeableCard } from './SwipeableCard';
import { haptics } from './haptics';
import { currencyOf } from './money';
import { categoryColor } from './categoryColor';
import { needsLabel } from './readinessLabel';
import type { AttentionItem, InboxItemRow } from '../inbox/useInboxSections';
import { draftReadiness } from '../inbox/readiness';
import type { Draft } from '../inbox/draft';
import { readDraft, readReviewJournal } from '../inbox/draftJson';
import { draftTotal, isSplitDraft } from '../inbox/draftSplits';
import { appLocale } from '../i18n';

/** What a failed queued change was, in words ("Saving a planned transaction failed"). */
const OP_KIND_KEYS: Record<string, string> = {
  create_transaction: 'inbox.opKind.create_transaction',
  update_transaction: 'inbox.opKind.update_transaction',
  delete_transaction: 'inbox.opKind.delete_transaction',
  attach_receipt: 'inbox.opKind.attach_receipt',
  recurring_review: 'inbox.opKind.recurring_review',
  update_account: 'inbox.opKind.update_account',
  save_planned: 'inbox.opKind.save_planned',
  delete_planned: 'inbox.opKind.delete_planned',
};

/** An error message cut to two lines; tapping it shows the whole of it, and again folds it. */
function ErrorText({ message }: { message: string }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityHint={open ? tr('inbox.showLess') : tr('inbox.showMore')}>
      <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]} numberOfLines={open ? undefined : 2} selectable={open}>
        {message}
      </Text>
      <Text style={[t.type.label, { color: t.color.accent }]}>{open ? tr('inbox.showLess') : tr('inbox.showMore')}</Text>
    </Pressable>
  );
}

function metaLine(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p).join(' · ');
}

// No swiping while selecting: a stray swipe mid-selection would confirm or delete one card.
function MaybeSwipeable({ disabled, children, ...props }: { disabled: boolean } & Parameters<typeof SwipeableCard>[0]) {
  return disabled ? <>{children}</> : <SwipeableCard {...props}>{children}</SwipeableCard>;
}

export function ConfirmCard({
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
  // Selecting or unselecting pops the card with the tick haptic (src/ui/feedback.ts).
  const selectPop = usePopOnChange(selection.selected, 1.03);
  const { t: tr } = useTranslation();
  const cardStyle = { marginHorizontal: t.space.lg, marginBottom: t.space.sm };
  const press = selection.active ? selection.toggle : onOpen;

  if (item.kind === 'receipt' && item.state === 'captured') {
    return (
      <MaybeSwipeable disabled={selection.active} onDelete={onDelete}>
        <Animated.View style={selectPop}>
        <Card onPress={press} onLongPress={selection.toggle} selected={selection.selected} style={cardStyle}>
          <Pulse active>
            <Text style={[t.type.body, { color: t.color.textMuted }]}>▦ {tr('inbox.readingReceipt')}</Text>
          </Pulse>
        </Card>
        </Animated.View>
      </MaybeSwipeable>
    );
  }

  const draft: Draft = readDraft(item.draftJson);
  const readiness = draftReadiness(draft);
  const isTransfer = draft.type === 'transfer';
  const payeeName = isTransfer
    ? `${draft.sourceName ?? '?'} → ${draft.destinationName ?? '?'}`
    : (draft.type === 'deposit' ? draft.sourceName : draft.destinationName) || draft.description;
  const accountName = draft.type === 'deposit' ? draft.destinationName : draft.sourceName;
  const time = new Date(draft.date).toLocaleTimeString(appLocale(), { hour: '2-digit', minute: '2-digit' });
  const splitCount = isSplitDraft(draft) ? (draft.extraSplits?.length ?? 0) + 1 : 0;
  const splitsLabel = splitCount ? tr('splits.count', { count: splitCount }) : null;
  const meta = isTransfer ? metaLine([splitsLabel, time]) : metaLine([splitsLabel ?? draft.categoryName, accountName, time]);
  const dotColor = draft.categoryName ? categoryColor(draft.categoryName, t.dark) : t.color.textFaint;

  const badges: { label: string; tone?: 'warn' }[] = [];
  if (draft.isNewPayee && !isTransfer) badges.push({ label: tr('inbox.newPayee'), tone: 'warn' });
  if (!readiness.ready) badges.push({ label: needsLabel(readiness.missing), tone: 'warn' });
  if (draft.sharedWith) badges.push({ label: tr('inbox.sharedWith', { name: draft.sharedWith }) });
  // Handed back by the outbox: something it points at was deleted in FF3 (src/sync/outbox.ts).
  if (item.errorMessage) badges.push({ label: item.errorMessage, tone: 'warn' });

  return (
    <MaybeSwipeable disabled={selection.active} onConfirm={onConfirm} onDelete={onDelete} confirmEnabled={readiness.ready} onRefused={haptics.warn}>
      <Animated.View style={selectPop}>
      <Card onPress={press} onLongPress={selection.toggle} selected={selection.selected} style={cardStyle}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
          <Text style={[t.type.heading, { color: t.color.text, flex: 1 }]} numberOfLines={1}>{payeeName}</Text>
          <Money amount={draftTotal(draft) || '0'} currency={currencyOf(currencies, draft.currencyCode)} type={draft.type} size="heading" />
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
      </Animated.View>
    </MaybeSwipeable>
  );
}

export function ReviewCard({
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
  const journal = readReviewJournal(item.draftJson);
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

export function AttentionCard({
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
        <ErrorText message={entry.item.errorMessage ?? tr('inbox.failed')} />
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
        ✕ {isConflict ? tr('inbox.conflict') : tr('inbox.operationFailed', { kind: tr(OP_KIND_KEYS[op.kind] ?? 'inbox.opKind.other') })}
      </Text>
      <ErrorText message={op.lastError ?? tr('inbox.unknownError')} />
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
