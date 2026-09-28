// Transaction detail (design §6.5) — the same editing vocabulary as the draft screen: hero
// amount + DetailRows, one picker implementation for both. A split transaction shows its tracked
// total and one page per split, swiped through; Split adds one (src/splits/).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appLocale } from '../../src/i18n';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { eq, ne } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { pickDateTime } from '../../src/ui/pickDate';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  AppBar,
  BarIconButton,
  Card,
  Button,
  Money,
  Row,
  Sheet,
} from '../../src/ui/components';
import { DetailRows, type DetailRowsValue } from '../../src/ui/DetailRows';
import { Keypad } from '../../src/ui/Keypad';
import { TextField } from '../../src/ui/TextField';
import { PayeeSheet } from '../../src/ui/PayeeSheet';
import { SplitPager } from '../../src/ui/SplitPager';
import {
  AllocationSheet,
  type AllocationMode,
  type AllocationResult,
} from '../../src/ui/AllocationSheet';
import { currencyOf, formatMoney } from '../../src/ui/money';
import { conflictFields } from '../../src/transactions/conflictDiff';
import { relativeTime } from '../../src/ui/relativeTime';
import { applyDigit, type KeypadKey } from '../../src/capture/amountInput';
import {
  cachedTransactions,
  inboxItems,
  outboxOperations,
  referenceCategories,
  referenceBudgets,
  referenceCurrencies,
} from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import type { UpdateTransactionPayload } from '../../src/sync/outbox';
import { queueTransactionDelete, queueTransactionEdit } from '../../src/transactions/queueEdit';
import { confirmDestructive } from '../../src/ui/confirm';
import { useQuery } from '@tanstack/react-query';
import { getClient } from '../../src/api/ff3/session';
import {
  fetchJournalAttachments,
  queuedAttachments,
  receiptPreviews,
} from '../../src/receipt/journalAttachments';
import type { TransactionSplit } from '../../src/api/ff3/types';
import { pendingEdits } from '../../src/transactions/pendingEdits';
import { payloadGroupId, readPayload } from '../../src/sync/payloadJson';
import { useAction } from '../../src/ui/useAction';
import { keepMineOverServer, dropQueuedChange } from '../../src/sync/outbox';
import { readSplits } from '../../src/transactions/splitsJson';
import { refreshCachedGroup } from '../../src/transactions/refreshGroup';
import { queueSplitEdit } from '../../src/transactions/queueSplitEdit';
import { changedFields, sameAmount, sameSplits } from '../../src/transactions/editDiff';
import { duplicateTransaction } from '../../src/transactions/duplicate';
import {
  fromCached,
  fromQueued,
  newSplit,
  patchSplit,
  toPayloadSplits,
  type EditableSplit,
} from '../../src/splits/editSplits';
import { absorb, leftover } from '../../src/splits/allocate';
import { useMerchantHistories } from '../../src/lookup/useMerchantHistories';
import { ReceiptThumb } from '../../src/ui/ReceiptThumb';

const SHARED_TAG_PREFIX = 'mmyway-shared-';
// The words the rest of the app uses (capture's type chips), not FF3's "Withdrawal"/"Deposit".
const TYPE_LABEL_KEYS: Record<string, string> = {
  withdrawal: 'capture.typeExpense',
  deposit: 'capture.typeIncome',
  transfer: 'capture.typeTransfer',
};

type TxType = 'withdrawal' | 'deposit' | 'transfer';

function parseTags(tagsJson: string): string[] {
  try {
    const tags: unknown = JSON.parse(tagsJson);
    return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function sharedWithOf(tags: string[]): string | null {
  const match = tags.find((tag) => tag.startsWith(SHARED_TAG_PREFIX));
  return match ? match.slice(SHARED_TAG_PREFIX.length) : null;
}

function withSharedWith(tags: string[], sharedWith: string | null): string[] {
  const withoutShared = tags.filter((tag) => !tag.startsWith(SHARED_TAG_PREFIX));
  return sharedWith ? [...withoutShared, `${SHARED_TAG_PREFIX}${sharedWith}`] : withoutShared;
}

export default function TransactionDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();

  const { data: rows } = useLiveQuery(
    db.select().from(cachedTransactions).where(eq(cachedTransactions.groupId, groupId)),
  );
  // The kinds that can touch one transaction; account edits never do.
  const { data: outbox } = useLiveQuery(
    db.select().from(outboxOperations).where(ne(outboxOperations.kind, 'update_account')),
  );
  // An old transaction can point at an account since made inactive — look its name up across
  // every account for display, but only offer active ones when picking a new one.
  const allAssetAccounts = useAssetAccounts({ includeInactive: true }) ?? [];
  const activeAssetAccounts = useAssetAccounts() ?? [];
  const { data: categories } = useLiveQuery(db.select().from(referenceCategories));
  const { data: budgets } = useLiveQuery(db.select().from(referenceBudgets));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const row = rows?.[0];
  // The photo this transaction was captured from, if the phone still has it (kept a while after
  // upload, see pruneUploadedReceiptImages): the preview while FF3's own list is unavailable.
  const { data: sourceItems } = useLiveQuery(
    db
      .select({ path: inboxItems.receiptImagePath })
      .from(inboxItems)
      .where(eq(inboxItems.ff3GroupId, groupId)),
  );
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

  // A split transaction cached before every split was kept: read it again from FF3.
  const cachedSplits = row ? readSplits(row.splitsJson) : null;
  const splitsRefresh = useQuery({
    queryKey: ['refresh-group', groupId],
    enabled: !!row && row.splitCount > 1 && !cachedSplits,
    queryFn: async () => {
      const client = await getClient(db);
      return client ? refreshCachedGroup(db, client, groupId) : false;
    },
    retry: false,
  });

  const lookupType = row?.type === 'withdrawal' || row?.type === 'deposit' ? row.type : undefined;
  const histories = useMerchantHistories(lookupType, { enabled: !!lookupType });

  const [changes, setChanges] = useState<Partial<TransactionSplit>>({});
  const [amountSheetOpen, setAmountSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  /** The file:// uri of the photo open full screen. */
  const [photo, setPhoto] = useState<string | null>(null);
  // Split editing: null means "as cached / as queued".
  const [edited, setEdited] = useState<EditableSplit[] | null>(null);
  const [totalEdit, setTotalEdit] = useState<string | null>(null);
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [allocation, setAllocation] = useState<{
    mode: AllocationMode;
    base: EditableSplit[];
  } | null>(null);
  const [keypadFor, setKeypadFor] = useState<number | 'total' | null>(null);
  const [textFor, setTextFor] = useState<number | 'title' | null>(null);
  const [payeeFor, setPayeeFor] = useState<number | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);

  if (!row)
    return (
      <Screen bottom>
        <AppBar title={tr('transaction.title')} />
      </Screen>
    );

  const type = row.type as TxType;
  const conflictOp = (outbox ?? []).find((op) => {
    if (op.status !== 'failed' || op.lastError !== 'conflict') return false;
    // recurring_review is an update too (the reviewed tag, plus any corrections) and conflicts the same way.
    if (
      op.kind !== 'update_transaction' &&
      op.kind !== 'delete_transaction' &&
      op.kind !== 'recurring_review'
    )
      return false;
    return payloadGroupId(op.kind, op.payloadJson) === groupId;
  });

  const currency = currencyOf(currencies ?? [], row.currencyCode);
  const dp = currency.decimalPlaces;
  // An edit saved earlier but not yet in FF3: shown as the current values (under this screen's
  // own unsaved `changes`), so reopening a just-saved transaction doesn't show the old ones.
  // Save still sends only this screen's `changes`; the queued edit replays first.
  const pendingEdit = pendingEdits(outbox ?? []).byGroup.get(row.groupId);
  const shown: Partial<TransactionSplit> = { ...pendingEdit?.changes, ...changes };

  // Receipt thumbnails: uploads still queued, from the phone, then what FF3 holds, fetched with the
  // API token like any request (src/receipt/journalAttachments.ts).
  const previews = receiptPreviews({
    queuedPaths: queued.map((q) => q.receiptImagePath).filter((p): p is string => !!p),
    capturedPath: localReceiptPath,
    remote: attachments.data,
  });
  const effectiveAmount = shown.amount ?? row.amount;
  const effectiveSourceId =
    shown.source_id ??
    row.sourceId ??
    allAssetAccounts.find((a) => a.name === row.sourceName)?.id ??
    null;
  const effectiveDestinationId =
    shown.destination_id ??
    row.destinationId ??
    allAssetAccounts.find((a) => a.name === row.destinationName)?.id ??
    null;
  const effectiveBudgetId =
    shown.budget_id ??
    row.budgetId ??
    (budgets ?? []).find((b) => b.name === row.budgetName)?.id ??
    null;
  const effectiveCategoryName = shown.category_name ?? row.categoryName ?? null;
  const effectiveDate = shown.date ? new Date(shown.date) : new Date(row.date);
  const effectiveNotes = shown.notes ?? row.notes ?? null;
  const effectiveTags = shown.tags ?? parseTags(row.tagsJson);
  const effectiveSharedWith = sharedWithOf(effectiveTags);
  const dateLabel = effectiveDate.toLocaleString(appLocale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  // The splits as they stand: this screen's edit, else a queued split edit, else the cache.
  const baseSplits: EditableSplit[] = pendingEdit?.splits
    ? pendingEdit.splits.map(fromQueued)
    : cachedSplits && cachedSplits.length > 1
      ? cachedSplits.map(fromCached)
      : [];
  const splits = edited ?? baseSplits;
  const splitMode = splits.length > 1 || edited !== null;
  const splitsLoading = row.splitCount > 1 && !cachedSplits && !pendingEdit?.splits;
  const total =
    totalEdit ?? (pendingEdit?.splits ? pendingEdit.changes.amount : undefined) ?? row.amount;
  const groupTitle = titleEdit ?? pendingEdit?.groupTitle ?? row.description;
  const rest = splitMode
    ? leftover(
        total,
        splits.map((s) => s.amount),
        dp,
      )
    : 0n;
  const pageIndex = Math.min(page, Math.max(0, splits.length - 1));

  /** The transaction as one split, with this screen's unsaved changes: where Split starts from. */
  function singleAsSplit(): EditableSplit {
    const destinationId = shown.destination_id ?? row!.destinationId ?? null;
    return {
      journalId: row!.journalId,
      amount: effectiveAmount,
      description: shown.description ?? row!.description,
      sourceId: effectiveSourceId,
      sourceName: row!.sourceName,
      destinationId: type === 'withdrawal' ? destinationId : effectiveDestinationId,
      destinationName: row!.destinationName,
      categoryName: effectiveCategoryName,
      budgetId: effectiveBudgetId,
      notes: effectiveNotes,
      tags: effectiveTags,
      internalReference: cachedSplits?.[0]?.internalReference ?? null,
    };
  }

  function handleDetailChange(change: Partial<DetailRowsValue>) {
    setChanges((prev) => {
      const next = { ...prev };
      if ('categoryName' in change) next.category_name = change.categoryName ?? undefined;
      if ('sourceAccountId' in change) next.source_id = change.sourceAccountId ?? undefined;
      if ('destinationAccountId' in change)
        next.destination_id = change.destinationAccountId ?? undefined;
      if ('budgetId' in change) next.budget_id = change.budgetId ?? undefined;
      if ('notes' in change) next.notes = change.notes ?? undefined;
      if ('sharedWith' in change)
        next.tags = withSharedWith(effectiveTags, change.sharedWith ?? null);
      return next;
    });
  }

  function editSplit(index: number, patch: Partial<EditableSplit>) {
    setEdited(patchSplit(splits, index, patch, type));
  }

  function handleSplitDetailChange(index: number, change: Partial<DetailRowsValue>) {
    if ('date' in change) return;
    const split = splits[index]!;
    const patch: Partial<EditableSplit> = {};
    if ('categoryName' in change) patch.categoryName = change.categoryName ?? null;
    if ('sourceAccountId' in change) {
      patch.sourceId = change.sourceAccountId ?? null;
      patch.sourceName = null;
    }
    if ('destinationAccountId' in change) {
      patch.destinationId = change.destinationAccountId ?? null;
      patch.destinationName = null;
    }
    if ('budgetId' in change) patch.budgetId = change.budgetId ?? null;
    if ('notes' in change) patch.notes = change.notes ?? null;
    if ('sharedWith' in change) patch.tags = withSharedWith(split.tags, change.sharedWith ?? null);
    editSplit(index, patch);
  }

  function openDatePicker() {
    pickDateTime(effectiveDate, (picked) =>
      setChanges((prev) => ({ ...prev, date: picked.toISOString() })),
    );
  }

  function startSplit() {
    setAllocation({ mode: { kind: 'newSplit' }, base: splitMode ? splits : [singleAsSplit()] });
  }

  /**
   * When `next` doesn't add up to `nextTotal`, split 1 takes the difference (split 2, if split 1
   * was just typed); only when it can't are the sliders asked.
   */
  function placeLeftover(next: EditableSplit[], nextTotal: string, exclude?: number) {
    const delta = leftover(
      nextTotal,
      next.map((s) => s.amount),
      dp,
    );
    if (delta === 0n || next.length < 2) return;
    const absorbed = absorb(
      next.map((s) => s.amount),
      delta,
      dp,
      exclude,
    );
    if (absorbed) setEdited(next.map((s, i) => ({ ...s, amount: absorbed[i]! })));
    else setAllocation({ mode: { kind: 'leftover', delta, exclude }, base: next });
  }

  /** The Reassign button: the sliders, whatever split 1 could take. */
  function askLeftover(next: EditableSplit[], nextTotal: string) {
    const delta = leftover(
      nextTotal,
      next.map((s) => s.amount),
      dp,
    );
    if (delta !== 0n && next.length > 1)
      setAllocation({ mode: { kind: 'leftover', delta }, base: next });
  }

  function onAllocated(result: AllocationResult) {
    if (!allocation) return;
    const next = allocation.base.map((s, i) => ({ ...s, amount: result.amounts[i] ?? s.amount }));
    if (allocation.mode.kind === 'newSplit' && result.newAmount) {
      if (!splitMode) setTotalEdit(effectiveAmount);
      next.push(newSplit(next[0]!, result.newAmount, groupTitle));
      setPage(next.length - 1);
    }
    setEdited(next);
    setAllocation(null);
  }

  function removeSplit(index: number) {
    const goneSplit = splits[index];
    const gone = goneSplit?.journalId;
    if (gone) setRemoved((r) => [...r, gone]);
    // The removed split may be the only one carrying the internal reference: the rest take it.
    const next = splits
      .filter((_, i) => i !== index)
      .map((s) => ({
        ...s,
        internalReference: s.internalReference ?? goneSplit?.internalReference ?? null,
      }));
    // One split left holds the whole total; with more, split 1 takes the removed amount.
    if (next.length === 1) next[0] = { ...next[0]!, amount: total };
    setEdited(next);
    setPage(Math.max(0, index - 1));
    placeLeftover(next, total);
  }

  function closeKeypad() {
    const target = keypadFor;
    setKeypadFor(null);
    if (target === 'total') placeLeftover(splits, total);
    else if (typeof target === 'number') {
      if (splits.length === 1) setTotalEdit(splits[0]!.amount);
      else placeLeftover(splits, total, target);
    }
  }

  const keepMine = act(tr('conflict.keepMine'), async () => {
    if (!conflictOp) return;
    await keepMineOverServer(db, conflictOp.id, row!.updatedAt);
  });
  const discardMine = act(tr('conflict.useServer'), async () => {
    if (!conflictOp) return;
    await dropQueuedChange(db, conflictOp.id);
  });

  // What the screen showed before this visit's edits: the cache, under any queued edit. Save
  // compares against it by value, so touching a field without changing it queues nothing.
  const baseline: Partial<TransactionSplit> = {
    amount: row.amount,
    date: row.date,
    description: row.description,
    category_name: row.categoryName ?? undefined,
    notes: row.notes ?? undefined,
    tags: parseTags(row.tagsJson),
    source_id: row.sourceId ?? allAssetAccounts.find((a) => a.name === row.sourceName)?.id,
    destination_id:
      row.destinationId ?? allAssetAccounts.find((a) => a.name === row.destinationName)?.id,
    budget_id: row.budgetId ?? (budgets ?? []).find((b) => b.name === row.budgetName)?.id,
    ...pendingEdit?.changes,
  };

  const onSave = act(tr('common.save'), async () => {
    if (splitMode) {
      const date = effectiveDate.toISOString();
      const payloadSplits = toPayloadSplits(splits, {
        type,
        date,
        currencyCode: row!.currencyCode,
      });
      const baseTotal =
        (pendingEdit?.splits ? pendingEdit.changes.amount : undefined) ?? row!.amount;
      const baseTitle = pendingEdit?.groupTitle ?? row!.description;
      const dirty =
        removed.length > 0 ||
        !sameAmount(total, baseTotal) ||
        groupTitle !== baseTitle ||
        Object.keys(changedFields({ date: changes.date }, { date: baseline.date })).length > 0 ||
        !sameSplits(
          payloadSplits,
          toPayloadSplits(baseSplits, { type, date, currencyCode: row!.currencyCode }),
        );
      if (!dirty) {
        router.back();
        return;
      }
      if (rest !== 0n) return;
      setSaving(true);
      try {
        await queueSplitEdit(db, {
          groupId: row!.groupId,
          transactionJournalId: row!.journalId,
          expectedUpdatedAt: row!.updatedAt,
          changes: {
            amount: total,
            description: groupTitle,
            ...(changes.date ? { date: changes.date } : {}),
          },
          splits: payloadSplits,
          groupTitle,
          ...(removed.length ? { removedJournalIds: removed } : {}),
        });
        router.back();
      } finally {
        setSaving(false);
      }
      return;
    }
    const toSend = changedFields(changes, baseline);
    if (Object.keys(toSend).length === 0) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      await queueTransactionEdit(db, row!, toSend);
      router.back();
    } finally {
      setSaving(false);
    }
  });

  const onDuplicate = act(tr('transaction.duplicate'), async () => {
    setMenuOpen(false);
    const id = await duplicateTransaction(db, row!);
    router.push(`/draft/${id}`);
  });

  const onDelete = act(tr('common.delete'), async () => {
    setMenuOpen(false);
    if (!(await confirmDestructive(tr('transaction.deleteTitle'), tr('common.delete')))) return;
    await queueTransactionDelete(db, row!);
    router.back();
  });

  if (conflictOp) {
    const pending = readPayload<UpdateTransactionPayload>(conflictOp.kind, conflictOp.payloadJson);
    const isDelete = conflictOp.kind === 'delete_transaction';
    const fields = isDelete
      ? []
      : conflictFields(pending.changes ?? {}, row, {
          accountName: (accountId) => allAssetAccounts.find((a) => a.id === accountId)?.name,
          budgetName: (budgetId) => (budgets ?? []).find((b) => b.id === budgetId)?.name,
          money: (amount) => formatMoney(amount, currency),
        });
    return (
      <Screen bottom>
        <AppBar title={tr('inbox.conflict')} left={<CloseButton />} />
        <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}>
          <Text style={[t.type.body, { color: t.color.textMuted }]}>
            {tr('conflict.changedInFf3', {
              description: row.description,
              time: relativeTime(row.updatedAt),
            })}{' '}
            {isDelete ? tr('conflict.youAskedToDelete') : tr('conflict.compareFields')}
          </Text>
          {!isDelete && (
            <Card>
              <View style={{ flexDirection: 'row', paddingBottom: t.space.sm }}>
                <Text style={[t.type.caption, { color: t.color.textMuted, flex: 1 }]}>
                  {tr('conflict.field')}
                </Text>
                <Text style={[t.type.caption, { color: t.color.textMuted, flex: 2 }]}>
                  {tr('conflict.server')}
                </Text>
                <Text style={[t.type.caption, { color: t.color.textMuted, flex: 2 }]}>
                  {tr('conflict.yours')}
                </Text>
              </View>
              {fields.map((f) => (
                <View
                  key={f.label}
                  style={{
                    flexDirection: 'row',
                    paddingVertical: t.space.sm,
                    borderTopWidth: 1,
                    borderTopColor: t.color.border,
                  }}
                >
                  <Text style={[t.type.label, { color: t.color.textMuted, flex: 1 }]}>
                    {f.label}
                  </Text>
                  <Text style={[t.type.body, { color: t.color.text, flex: 2 }]}>{f.server}</Text>
                  <Text
                    style={[
                      t.type.body,
                      {
                        color: f.differs ? t.color.accent : t.color.text,
                        flex: 2,
                        fontWeight: f.differs ? '600' : '400',
                      },
                    ]}
                  >
                    {f.mine}
                  </Text>
                </View>
              ))}
              {fields.every((f) => !f.differs) && (
                <Text style={[t.type.label, { color: t.color.textMuted, paddingTop: t.space.sm }]}>
                  {tr('conflict.matchesServer')}
                </Text>
              )}
            </Card>
          )}
          <Button
            title={isDelete ? tr('conflict.deleteAnyway') : tr('conflict.keepMine')}
            onPress={keepMine}
          />
          <Button
            title={isDelete ? tr('conflict.keepTransaction') : tr('conflict.useServer')}
            variant="danger"
            onPress={discardMine}
          />
        </ScrollView>
      </Screen>
    );
  }

  const detailValue: DetailRowsValue = {
    type,
    categoryName: effectiveCategoryName,
    sourceAccountId: effectiveSourceId,
    destinationAccountId: effectiveDestinationId,
    budgetId: effectiveBudgetId,
    dateLabel,
    notes: effectiveNotes,
    sharedWith: effectiveSharedWith,
  };

  function splitDetailValue(split: EditableSplit): DetailRowsValue {
    return {
      type,
      categoryName: split.categoryName,
      sourceAccountId:
        split.sourceId ?? allAssetAccounts.find((a) => a.name === split.sourceName)?.id ?? null,
      destinationAccountId:
        split.destinationId ??
        allAssetAccounts.find((a) => a.name === split.destinationName)?.id ??
        null,
      budgetId: split.budgetId,
      dateLabel,
      notes: split.notes,
      sharedWith: sharedWithOf(split.tags),
    };
  }

  const payeeOf = (split: EditableSplit) =>
    type === 'deposit' ? split.sourceName : split.destinationName;

  function renderSplitPage(index: number) {
    const split = splits[index]!;
    return (
      <>
        <View style={{ alignItems: 'center', paddingHorizontal: t.space.xl, gap: t.space.xs }}>
          <Pressable
            onPress={() => setKeypadFor(index)}
            accessibilityRole="button"
            accessibilityLabel={tr('fields.amount')}
          >
            <Money amount={split.amount} currency={currency} type={type} size="heading" />
          </Pressable>
          <Pressable
            onPress={() => setTextFor(index)}
            accessibilityRole="button"
            accessibilityLabel={tr('fields.description')}
          >
            <Text
              style={[t.type.body, { color: t.color.text, textAlign: 'center' }]}
              numberOfLines={2}
            >
              {split.description || '—'}
            </Text>
          </Pressable>
          {type !== 'transfer' && (
            <Pressable
              onPress={() => setPayeeFor(index)}
              accessibilityRole="button"
              accessibilityLabel={type === 'deposit' ? tr('capture.payer') : tr('capture.payee')}
            >
              <Text style={[t.type.label, { color: t.color.accent }]}>{payeeOf(split) || '—'}</Text>
            </Pressable>
          )}
        </View>
        <DetailRows
          value={splitDetailValue(split)}
          onChange={(change) => handleSplitDetailChange(index, change)}
          onDatePress={openDatePicker}
          accounts={allAssetAccounts}
          pickableAccounts={activeAssetAccounts}
          currencies={currencies ?? []}
          categories={categories ?? []}
          budgets={budgets ?? []}
        />
        {splits.length > 1 && (
          <View style={{ paddingHorizontal: t.space.lg }}>
            <Button
              title={tr('splits.remove')}
              variant="danger"
              onPress={() => removeSplit(index)}
            />
          </View>
        )}
      </>
    );
  }

  const keypadValue =
    keypadFor === 'total'
      ? total
      : typeof keypadFor === 'number'
        ? (splits[keypadFor]?.amount ?? '0')
        : effectiveAmount;

  return (
    <Screen bottom>
      <View style={{ flex: 1 }}>
        <AppBar
          title={TYPE_LABEL_KEYS[row.type] ? tr(TYPE_LABEL_KEYS[row.type]!) : row.type}
          subtitle={
            pendingEdit
              ? pendingEdit.status === 'queued'
                ? tr('transaction.changesQueued')
                : tr('transaction.changesNotSent')
              : tr('transaction.syncedAgo', { time: relativeTime(row.syncedAt) })
          }
          left={<CloseButton />}
          right={
            <>
              <BarIconButton
                icon="copy-outline"
                label={tr('transaction.duplicate')}
                onPress={onDuplicate}
              />
              <BarIconButton
                icon="ellipsis-horizontal"
                label={tr('capture.more')}
                onPress={() => setMenuOpen(true)}
              />
            </>
          }
        />

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: t.space.md, paddingBottom: t.space.lg }}
        >
          {splitMode ? (
            <>
              <Pressable
                onPress={() => setTextFor('title')}
                style={{ paddingHorizontal: t.space.xl, paddingTop: t.space.md }}
                accessibilityRole="button"
                accessibilityLabel={tr('splits.title')}
              >
                <Text
                  style={[t.type.heading, { color: t.color.text, textAlign: 'center' }]}
                  numberOfLines={2}
                >
                  {groupTitle}
                </Text>
              </Pressable>
              <SplitPager
                total={total}
                count={splits.length}
                index={pageIndex}
                onIndexChange={setPage}
                currency={currency}
                type={type}
                leftover={rest}
                onTotalPress={() => setKeypadFor('total')}
                onReassign={() => askLeftover(splits, total)}
                renderPage={renderSplitPage}
              />
            </>
          ) : (
            <>
              {/* The description can be a long legal name ("TOP-PHARMA spółka z o.o. sp.k. …"): padded,
                centred and capped at two lines instead of running into both screen edges. */}
              <View
                style={{
                  alignItems: 'center',
                  paddingVertical: t.space.lg,
                  paddingHorizontal: t.space.xl,
                }}
              >
                <Pressable onPress={() => setAmountSheetOpen(true)} disabled={splitsLoading}>
                  <Money amount={effectiveAmount} currency={currency} type={type} size="title" />
                </Pressable>
                {splitsLoading && (
                  <Text style={[t.type.label, { color: t.color.textMuted }]}>
                    {splitsRefresh.isError || splitsRefresh.data === false
                      ? tr('splits.loadFailed')
                      : tr('splits.loading')}
                  </Text>
                )}
                <Text
                  style={[
                    t.type.heading,
                    { color: t.color.text, marginTop: t.space.xs, textAlign: 'center' },
                  ]}
                  numberOfLines={2}
                >
                  {row.description}
                </Text>
              </View>
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
            </>
          )}
          <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
            {previews.map((p) => (
              <ReceiptThumb key={p.key} preview={p} onOpen={setPhoto} />
            ))}
            <View>
              {(attachments.data ?? []).map((a, i) => (
                <Row
                  key={a.id}
                  first={i === 0}
                  label={i === 0 ? tr('draft.receipt') : ''}
                  value={`📎 ${a.filename}`}
                />
              ))}
              {queued.map((q, i) => (
                <Row
                  key={q.opId}
                  first={i === 0 && !attachments.data?.length}
                  label={i === 0 && !attachments.data?.length ? tr('draft.receipt') : ''}
                  value={
                    q.status === 'failed'
                      ? q.lastError
                        ? tr('transaction.uploadFailedWith', { error: q.lastError })
                        : tr('transaction.uploadFailed')
                      : tr('transaction.uploading')
                  }
                  tone={q.status === 'failed' ? 'danger' : undefined}
                />
              ))}
              <Row
                first={!attachments.data?.length && queued.length === 0}
                label={!attachments.data?.length && queued.length === 0 ? tr('draft.receipt') : ''}
                value={
                  attachments.data?.length || queued.length
                    ? tr('transaction.attachAnother')
                    : tr('receipt.attachTitle')
                }
                chevron
                onPress={() =>
                  router.push({
                    pathname: '/receipt',
                    params: { attachToJournalId: row.journalId },
                  })
                }
              />
            </View>
          </Card>
        </ScrollView>

        <View style={{ padding: t.space.lg, flexDirection: 'row', gap: t.space.sm }}>
          <Button
            title={saving ? tr('common.saving') : tr('common.save')}
            onPress={onSave}
            disabled={saving || rest !== 0n}
            size="lg"
            style={{ flex: 1 }}
          />
          <Button
            title={tr('splits.split')}
            variant="secondary"
            onPress={startSplit}
            disabled={saving || splitsLoading}
            size="lg"
          />
        </View>
      </View>

      <Sheet
        visible={amountSheetOpen}
        onClose={() => setAmountSheetOpen(false)}
        title={tr('fields.amount')}
      >
        <Money amount={effectiveAmount} currency={currency} type={type} size="display" />
        <Keypad
          compact
          onDigit={(key: KeypadKey) =>
            setChanges((prev) => ({
              ...prev,
              amount: applyDigit(prev.amount ?? pendingEdit?.changes.amount ?? row.amount, key, dp),
            }))
          }
          saveLabel={tr('common.done')}
          onSave={() => setAmountSheetOpen(false)}
        />
      </Sheet>

      <Sheet
        visible={keypadFor !== null}
        onClose={closeKeypad}
        title={keypadFor === 'total' ? tr('splits.total') : tr('fields.amount')}
      >
        <Money amount={keypadValue} currency={currency} type={type} size="display" />
        <Keypad
          compact
          onDigit={(key: KeypadKey) => {
            if (keypadFor === 'total') setTotalEdit(applyDigit(total, key, dp));
            else if (typeof keypadFor === 'number')
              editSplit(keypadFor, { amount: applyDigit(splits[keypadFor]!.amount, key, dp) });
          }}
          saveLabel={tr('common.done')}
          onSave={closeKeypad}
        />
      </Sheet>

      <Sheet
        visible={textFor !== null}
        onClose={() => setTextFor(null)}
        title={textFor === 'title' ? tr('splits.title') : tr('fields.description')}
        footer={<Button title={tr('common.done')} onPress={() => setTextFor(null)} />}
      >
        <TextField
          value={
            textFor === 'title'
              ? groupTitle
              : typeof textFor === 'number'
                ? (splits[textFor]?.description ?? '')
                : ''
          }
          onChangeText={(value) => {
            if (textFor === 'title') setTitleEdit(value);
            else if (typeof textFor === 'number') editSplit(textFor, { description: value });
          }}
          autoFocus
        />
      </Sheet>

      <PayeeSheet
        visible={payeeFor !== null}
        onClose={() => setPayeeFor(null)}
        histories={histories}
        payeeLabel={type === 'deposit' ? 'payer' : 'payee'}
        onSelect={(h) => {
          if (payeeFor === null) return;
          editSplit(
            payeeFor,
            type === 'deposit'
              ? { sourceName: h.displayName, sourceId: null }
              : { destinationName: h.displayName, destinationId: null },
          );
        }}
        onCreateNew={(text) => {
          if (payeeFor === null) return;
          editSplit(
            payeeFor,
            type === 'deposit'
              ? { sourceName: text, sourceId: null }
              : { destinationName: text, destinationId: null },
          );
        }}
      />

      {!!allocation && (
        <AllocationSheet
          visible
          mode={allocation.mode}
          amounts={allocation.base.map((s) => s.amount)}
          labels={allocation.base.map(
            (s, i) =>
              tr('splits.position', { index: i + 1, count: allocation.base.length }) +
              (s.categoryName ? ` · ${s.categoryName}` : ''),
          )}
          currency={currency}
          type={type}
          onDone={onAllocated}
          onClose={() => setAllocation(null)}
        />
      )}

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={tr('transaction.title')}>
        <Row first label={tr('transaction.duplicate')} icon="copy-outline" onPress={onDuplicate} />
        <Row label={tr('common.delete')} icon="trash-outline" tone="danger" onPress={onDelete} />
      </Sheet>
      {/* Same full-screen view as the draft screen's receipt photo. */}
      <Modal
        visible={!!photo}
        transparent
        animationType="fade"
        onRequestClose={() => setPhoto(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: t.color.photoBackdrop, justifyContent: 'center' }}
          onPress={() => setPhoto(null)}
          accessibilityLabel={tr('draft.closePhoto')}
        >
          {!!photo && (
            <Image
              source={{ uri: photo }}
              resizeMode="contain"
              style={{ width: '100%', height: '100%' }}
            />
          )}
        </Pressable>
      </Modal>
    </Screen>
  );
}

function CloseButton() {
  const { t: tr } = useTranslation();
  return <BarIconButton icon="close" label={tr('common.close')} onPress={() => router.back()} />;
}
