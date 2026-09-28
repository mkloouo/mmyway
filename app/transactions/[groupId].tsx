// Transaction detail (design §6.5) — the same editing vocabulary as the draft screen: hero
// amount + DetailRows, one picker implementation for both.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appLocale } from '../../src/i18n';
import { Alert, Image, Modal, Pressable, ScrollView, Text, View, type ImageSourcePropType } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { eq, ne } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, BarIconButton, Card, Button, Money, Row, Sheet } from '../../src/ui/components';
import { DetailRows, type DetailRowsValue } from '../../src/ui/DetailRows';
import { Keypad } from '../../src/ui/Keypad';
import { currencyOf, formatMoney } from '../../src/ui/money';
import { conflictFields } from '../../src/transactions/conflictDiff';
import { relativeTime } from '../../src/ui/relativeTime';
import { applyDigit, type KeypadKey } from '../../src/capture/amountInput';
import { buildEntryDate } from '../../src/capture/entryDate';
import { cachedTransactions, inboxItems, outboxOperations, referenceCategories, referenceBudgets, referenceCurrencies } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import { enqueueOperation, type UpdateTransactionPayload, type DeleteTransactionPayload } from '../../src/sync/outbox';
import { generateId } from '../../src/utils/id';
import { useQuery } from '@tanstack/react-query';
import { getClient } from '../../src/api/ff3/session';
import { fetchJournalAttachments, queuedAttachments } from '../../src/receipt/journalAttachments';
import type { TransactionSplit } from '../../src/api/ff3/types';
import { pendingEdits } from '../../src/transactions/pendingEdits';
import { readPayload, writePayload } from '../../src/sync/payloadJson';

const SHARED_TAG_PREFIX = 'mmyway-shared-';
// The words the rest of the app uses (capture's type chips), not FF3's "Withdrawal"/"Deposit".
const TYPE_LABEL_KEYS: Record<string, string> = { withdrawal: 'capture.typeExpense', deposit: 'capture.typeIncome', transfer: 'capture.typeTransfer' };

function sharedWithFromTags(tagsJson: string): string | null {
  try {
    const tags: string[] = JSON.parse(tagsJson);
    const match = tags.find((tag) => tag.startsWith(SHARED_TAG_PREFIX));
    return match ? match.slice(SHARED_TAG_PREFIX.length) : null;
  } catch {
    return null;
  }
}

export default function TransactionDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();

  const { data: rows } = useLiveQuery(db.select().from(cachedTransactions).where(eq(cachedTransactions.groupId, groupId)));
  // The kinds that can touch one transaction; account edits never do.
  const { data: outbox } = useLiveQuery(db.select().from(outboxOperations).where(ne(outboxOperations.kind, 'update_account')));
  // An old transaction can point at an account since made inactive — look its name up across
  // every account for display, but only offer active ones when picking a new one.
  const allAssetAccounts = useAssetAccounts({ includeInactive: true }) ?? [];
  const activeAssetAccounts = useAssetAccounts() ?? [];
  const { data: categories } = useLiveQuery(db.select().from(referenceCategories));
  const { data: budgets } = useLiveQuery(db.select().from(referenceBudgets));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const row = rows?.[0];
  // The photo this transaction was captured from, if the phone still has it (kept a while after
  // upload, see pruneUploadedReceiptImages) — shown without a round trip to FF3.
  const { data: sourceItems } = useLiveQuery(db.select({ path: inboxItems.receiptImagePath }).from(inboxItems).where(eq(inboxItems.ff3GroupId, groupId)));
  const localReceiptPath = sourceItems?.find((i) => !!i.path)?.path ?? null;

  // Receipt status: uploads still queued here, and what FF3 already holds. Refetched whenever the
  // number of queued uploads changes, so a finished upload shows up without leaving the screen.
  const queued = row ? queuedAttachments(outbox ?? [], row.journalId) : [];
  const attachments = useQuery({
    queryKey: ['journal-attachments', groupId, row?.journalId, queued.length],
    enabled: !!row,
    queryFn: async () => {
      const client = await getClient(db);
      return client ? fetchJournalAttachments(client, groupId, row!.journalId) : null;
    },
    retry: false,
  });

  const [changes, setChanges] = useState<Partial<TransactionSplit>>({});
  const [amountSheetOpen, setAmountSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState<ImageSourcePropType | null>(null);

  if (!row) return <Screen bottom><AppBar title={tr('transaction.title')} /></Screen>;

  const conflictOp = (outbox ?? []).find((op) => {
    if (op.status !== 'failed' || op.lastError !== 'conflict') return false;
    // recurring_review is an update too (the reviewed tag, plus any corrections) and conflicts the same way.
    if (op.kind !== 'update_transaction' && op.kind !== 'delete_transaction' && op.kind !== 'recurring_review') return false;
    return JSON.parse(op.payloadJson).groupId === groupId;
  });

  const currency = currencyOf(currencies ?? [], row.currencyCode);
  // An edit saved earlier but not yet in FF3: shown as the current values (under this screen's
  // own unsaved `changes`), so reopening a just-saved transaction doesn't show the old ones.
  // Save still sends only this screen's `changes`; the queued edit replays first.
  const pendingEdit = pendingEdits(outbox ?? []).byGroup.get(row.groupId);
  const shown: Partial<TransactionSplit> = { ...pendingEdit?.changes, ...changes };

  // Receipt thumbnails: photos on the phone first (still waiting to upload, or the one this was
  // captured from), then what FF3 holds, fetched with the API token like any request. Once the
  // captured photo has uploaded it is FF3's first image too, so that download is skipped.
  const queuedPaths = queued.map((q) => q.receiptImagePath).filter((p): p is string => !!p);
  const localPaths = [...new Set([...queuedPaths, ...(localReceiptPath ? [localReceiptPath] : [])])];
  const capturedUploaded = !!localReceiptPath && !queuedPaths.includes(localReceiptPath);
  const remoteImages = (attachments.data ?? []).filter((a) => !!a.imageSource).slice(capturedUploaded ? 1 : 0);
  const receiptPreviews: { key: string; source: ImageSourcePropType }[] = [
    ...localPaths.map((uri) => ({ key: uri, source: { uri } })),
    ...remoteImages.map((a) => ({ key: a.id, source: a.imageSource! })),
  ];
  const effectiveAmount = shown.amount ?? row.amount;
  const effectiveSourceId = shown.source_id ?? row.sourceId ?? allAssetAccounts.find((a) => a.name === row.sourceName)?.id ?? null;
  const effectiveDestinationId = shown.destination_id ?? row.destinationId ?? allAssetAccounts.find((a) => a.name === row.destinationName)?.id ?? null;
  const effectiveBudgetId = shown.budget_id ?? row.budgetId ?? (budgets ?? []).find((b) => b.name === row.budgetName)?.id ?? null;
  const effectiveCategoryName = shown.category_name ?? row.categoryName ?? null;
  const effectiveDate = shown.date ? new Date(shown.date) : new Date(row.date);
  const effectiveNotes = shown.notes ?? row.notes ?? null;
  const effectiveSharedWith = shown.tags
    ? shown.tags.find((tag) => tag.startsWith(SHARED_TAG_PREFIX))?.slice(SHARED_TAG_PREFIX.length) ?? null
    : sharedWithFromTags(row.tagsJson);

  function handleDetailChange(change: Partial<DetailRowsValue>) {
    setChanges((prev) => {
      const next = { ...prev };
      if ('categoryName' in change) next.category_name = change.categoryName ?? undefined;
      if ('sourceAccountId' in change) next.source_id = change.sourceAccountId ?? undefined;
      if ('destinationAccountId' in change) next.destination_id = change.destinationAccountId ?? undefined;
      if ('budgetId' in change) next.budget_id = change.budgetId ?? undefined;
      if ('notes' in change) next.notes = change.notes ?? undefined;
      if ('sharedWith' in change) {
        let existingTags: string[] = pendingEdit?.changes.tags ?? [];
        if (!pendingEdit?.changes.tags) {
          try { existingTags = JSON.parse(row!.tagsJson); } catch { existingTags = []; }
        }
        const withoutShared = existingTags.filter((tag) => !tag.startsWith(SHARED_TAG_PREFIX));
        next.tags = change.sharedWith ? [...withoutShared, `${SHARED_TAG_PREFIX}${change.sharedWith}`] : withoutShared;
      }
      return next;
    });
  }

  function openDatePicker() {
    DateTimePickerAndroid.open({
      value: effectiveDate,
      mode: 'date',
      onChange: (event: { type: string }, picked?: Date) => {
        if (event.type === 'set' && picked) {
          setChanges((prev) => ({ ...prev, date: buildEntryDate(picked, effectiveDate).toISOString() }));
        }
      },
    });
  }

  async function keepMine() {
    if (!conflictOp) return;
    const payload = readPayload<UpdateTransactionPayload | DeleteTransactionPayload>(conflictOp.kind, conflictOp.payloadJson);
    payload.expectedUpdatedAt = row!.updatedAt;
    await db.update(outboxOperations).set({ status: 'pending', payloadJson: writePayload(payload), lastError: null }).where(eq(outboxOperations.id, conflictOp.id));
  }
  async function discardMine() {
    if (!conflictOp) return;
    await db.delete(outboxOperations).where(eq(outboxOperations.id, conflictOp.id));
  }

  async function onSave() {
    if (Object.keys(changes).length === 0) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      await enqueueOperation(db, {
        id: generateId(),
        kind: 'update_transaction',
        payload: { groupId: row!.groupId, transactionJournalId: row!.journalId, expectedUpdatedAt: row!.updatedAt, changes },
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  function onDelete() {
    setMenuOpen(false);
    Alert.alert(tr('transaction.deleteTitle'), undefined, [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('common.delete'), style: 'destructive',
        onPress: async () => {
          await enqueueOperation(db, { id: generateId(), kind: 'delete_transaction', payload: { groupId: row!.groupId, expectedUpdatedAt: row!.updatedAt } });
          router.back();
        },
      },
    ]);
  }

  if (conflictOp) {
    const pending = readPayload<UpdateTransactionPayload>(conflictOp.kind, conflictOp.payloadJson);
    const isDelete = conflictOp.kind === 'delete_transaction';
    const fields = isDelete ? [] : conflictFields(pending.changes ?? {}, row, {
      accountName: (accountId) => allAssetAccounts.find((a) => a.id === accountId)?.name,
      budgetName: (budgetId) => (budgets ?? []).find((b) => b.id === budgetId)?.name,
      money: (amount) => formatMoney(amount, currency),
    });
    return (
      <Screen bottom>
        <AppBar title={tr('inbox.conflict')} left={<CloseButton />} />
        <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}>
          <Text style={[t.type.body, { color: t.color.textMuted }]}>
            {tr('conflict.changedInFf3', { description: row.description, time: relativeTime(row.updatedAt) })}
            {' '}
            {isDelete ? tr('conflict.youAskedToDelete') : tr('conflict.compareFields')}
          </Text>
          {!isDelete && (
            <Card>
              <View style={{ flexDirection: 'row', paddingBottom: t.space.sm }}>
                <Text style={[t.type.caption, { color: t.color.textMuted, flex: 1 }]}>{tr('conflict.field')}</Text>
                <Text style={[t.type.caption, { color: t.color.textMuted, flex: 2 }]}>{tr('conflict.server')}</Text>
                <Text style={[t.type.caption, { color: t.color.textMuted, flex: 2 }]}>{tr('conflict.yours')}</Text>
              </View>
              {fields.map((f) => (
                <View key={f.label} style={{ flexDirection: 'row', paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border }}>
                  <Text style={[t.type.label, { color: t.color.textMuted, flex: 1 }]}>{f.label}</Text>
                  <Text style={[t.type.body, { color: t.color.text, flex: 2 }]}>{f.server}</Text>
                  <Text style={[t.type.body, { color: f.differs ? t.color.accent : t.color.text, flex: 2, fontWeight: f.differs ? '600' : '400' }]}>{f.mine}</Text>
                </View>
              ))}
              {fields.every((f) => !f.differs) && (
                <Text style={[t.type.label, { color: t.color.textMuted, paddingTop: t.space.sm }]}>
                  {tr('conflict.matchesServer')}
                </Text>
              )}
            </Card>
          )}
          <Button title={isDelete ? tr('conflict.deleteAnyway') : tr('conflict.keepMine')} onPress={keepMine} />
          <Button title={isDelete ? tr('conflict.keepTransaction') : tr('conflict.useServer')} variant="danger" onPress={discardMine} />
        </ScrollView>
      </Screen>
    );
  }

  const detailValue: DetailRowsValue = {
    type: row.type as 'withdrawal' | 'deposit' | 'transfer',
    categoryName: effectiveCategoryName,
    sourceAccountId: effectiveSourceId,
    destinationAccountId: effectiveDestinationId,
    budgetId: effectiveBudgetId,
    dateLabel: effectiveDate.toLocaleString(appLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    notes: effectiveNotes,
    sharedWith: effectiveSharedWith,
  };

  return (
    <Screen bottom>
      <View style={{ flex: 1 }}>
        <AppBar
          title={TYPE_LABEL_KEYS[row.type] ? tr(TYPE_LABEL_KEYS[row.type]!) : row.type}
          subtitle={pendingEdit ? (pendingEdit.status === 'queued' ? tr('transaction.changesQueued') : tr('transaction.changesNotSent')) : tr('transaction.syncedAgo', { time: relativeTime(row.syncedAt) })}
          left={<CloseButton />}
          right={(
            <BarIconButton icon="ellipsis-horizontal" label={tr('capture.more')} onPress={() => setMenuOpen(true)} />
          )}
        />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: t.space.md, paddingBottom: t.space.lg }}>
        {/* The description can be a long legal name ("TOP-PHARMA spółka z o.o. sp.k. …"): padded,
            centred and capped at two lines instead of running into both screen edges. */}
        <View style={{ alignItems: 'center', paddingVertical: t.space.lg, paddingHorizontal: t.space.xl }}>
          {/* A split group shows its total; edits reach only the first split, so its amount isn't editable here. */}
          <Pressable onPress={() => setAmountSheetOpen(true)} disabled={row.splitCount > 1}>
            <Money amount={effectiveAmount} currency={currency} type={row.type as 'withdrawal' | 'deposit' | 'transfer'} size="title" />
          </Pressable>
          {row.splitCount > 1 && (
            <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('transaction.splits', { count: row.splitCount })}</Text>
          )}
          <Text style={[t.type.heading, { color: t.color.text, marginTop: t.space.xs, textAlign: 'center' }]} numberOfLines={2}>{row.description}</Text>
        </View>

        <View style={{ gap: t.space.md }}>
          <DetailRows
            value={detailValue}
            onChange={handleDetailChange}
            onDatePress={openDatePicker}
            accounts={allAssetAccounts}
            pickableAccounts={activeAssetAccounts}
            currencies={currencies ?? []}
            categories={categories ?? []}
            budgets={budgets ?? []}
          />
          <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
            {receiptPreviews.map((p) => (
              <Pressable key={p.key} onPress={() => setPhoto(p.source)} accessibilityRole="imagebutton" accessibilityLabel={tr('draft.showPhoto')}>
                <Image source={p.source} resizeMode="cover" style={{ width: '100%', height: 140, borderRadius: t.radius.sm, backgroundColor: t.color.surfaceAlt }} />
              </Pressable>
            ))}
            <View>
              {(attachments.data ?? []).map((a, i) => (
                <Row key={a.id} first={i === 0} label={i === 0 ? tr('draft.receipt') : ''} value={`📎 ${a.filename}`} />
              ))}
              {queued.map((q, i) => (
                <Row
                  key={q.opId}
                  first={i === 0 && !attachments.data?.length}
                  label={i === 0 && !attachments.data?.length ? tr('draft.receipt') : ''}
                  value={q.status === 'failed' ? (q.lastError ? tr('transaction.uploadFailedWith', { error: q.lastError }) : tr('transaction.uploadFailed')) : tr('transaction.uploading')}
                  tone={q.status === 'failed' ? 'danger' : undefined}
                />
              ))}
              <Row
                first={!attachments.data?.length && queued.length === 0}
                label={!attachments.data?.length && queued.length === 0 ? tr('draft.receipt') : ''}
                value={attachments.data?.length || queued.length ? tr('transaction.attachAnother') : tr('receipt.attachTitle')}
                chevron
                onPress={() => router.push({ pathname: '/receipt', params: { attachToJournalId: row.journalId } })}
              />
            </View>
          </Card>
        </View>
        </ScrollView>

        <View style={{ padding: t.space.lg }}>
          <Button title={saving ? tr('common.saving') : tr('common.save')} onPress={onSave} disabled={saving} size="lg" />
        </View>
      </View>

      <Sheet visible={amountSheetOpen} onClose={() => setAmountSheetOpen(false)} title={tr('fields.amount')}>
        <Money amount={effectiveAmount} currency={currency} type={row.type as 'withdrawal' | 'deposit' | 'transfer'} size="display" />
        <Keypad
          compact
          onDigit={(key: KeypadKey) => setChanges((prev) => ({ ...prev, amount: applyDigit(prev.amount ?? pendingEdit?.changes.amount ?? row.amount, key, currency.decimalPlaces) }))}
          saveLabel={tr('common.done')}
          onSave={() => setAmountSheetOpen(false)}
        />
      </Sheet>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={tr('transaction.title')}>
        <Row first label={tr('common.delete')} tone="danger" onPress={onDelete} />
      </Sheet>
      {/* Same full-screen view as the draft screen's receipt photo. */}
      <Modal visible={!!photo} transparent animationType="fade" onRequestClose={() => setPhoto(null)}>
        <Pressable style={{ flex: 1, backgroundColor: t.color.photoBackdrop, justifyContent: 'center' }} onPress={() => setPhoto(null)} accessibilityLabel={tr('draft.closePhoto')}>
          {!!photo && <Image source={photo} resizeMode="contain" style={{ width: '100%', height: '100%' }} />}
        </Pressable>
      </Modal>
    </Screen>
  );
}

function CloseButton() {
  const { t: tr } = useTranslation();
  return <BarIconButton icon="close" label={tr('common.close')} onPress={() => router.back()} />;
}
