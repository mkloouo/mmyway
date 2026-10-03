// Transaction detail (design §6.5) — the same editing vocabulary as the draft screen: hero
// amount + DetailRows, one picker implementation for both. A split transaction shows its tracked
// total and one page per split, swiped through; Split adds one (src/splits/).
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appLocale } from '../../src/i18n';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { eq, ne } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useBudgetRows, useCategories, useCurrencyRows } from '../../src/db/useReferenceData';
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
  CloseButton,
} from '../../src/ui/components';
import { DetailRows, type DetailRowsValue } from '../../src/ui/DetailRows';
import { Keypad } from '../../src/ui/Keypad';
import { TextField } from '../../src/ui/TextField';
import { PayeeSheet } from '../../src/ui/PayeeSheet';
import { SplitPager } from '../../src/ui/SplitPager';
import { SplitPage } from '../../src/ui/SplitPage';
import { PhotoViewer } from '../../src/ui/PhotoViewer';
import {
  AllocationSheet,
  type AllocationMode,
  type AllocationResult,
} from '../../src/ui/AllocationSheet';
import { currencyOf } from '../../src/ui/money';
import { relativeTime } from '../../src/ui/relativeTime';
import { applyDigit, applyFirstKey, type KeypadKey } from '../../src/capture/amountInput';
import { cachedTransactions, inboxItems, outboxOperations } from '../../src/db/schema';
import { useSharedPeople } from '../../src/lookup/sharedPeople';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import { queueTransactionDelete, queueTransactionEdit } from '../../src/transactions/queueEdit';
import { confirmDestructive } from '../../src/ui/confirm';
import { useQuery } from '@tanstack/react-query';
import { getClient } from '../../src/api/ff3/session';
import {
  fetchJournalAttachments,
  queuedAttachmentDeletes,
  queuedAttachments,
  receiptPreviews,
} from '../../src/receipt/journalAttachments';
import { deleteJournalAttachment } from '../../src/receipt/ingest';
import { pendingEdits } from '../../src/transactions/pendingEdits';
import { payloadGroupId } from '../../src/sync/payloadJson';
import { useAction } from '../../src/ui/useAction';
import { readSplits } from '../../src/transactions/splitsJson';
import { refreshCachedGroup } from '../../src/transactions/refreshGroup';
import { queueSplitEdit } from '../../src/transactions/queueSplitEdit';
import {
  changedFields,
  sameAmount,
  sameSplits,
  type EditChanges,
} from '../../src/transactions/editDiff';
import { duplicateTransaction } from '../../src/transactions/duplicate';
import {
  fromCached,
  fromQueued,
  newSplit,
  patchSplit,
  toPayloadSplits,
  type EditableSplit,
} from '../../src/splits/editSplits';
import { leftover } from '../../src/splits/allocate';
import { askLeftover, placeLeftover } from '../../src/splits/placeLeftover';
import { useMerchantHistories } from '../../src/lookup/useMerchantHistories';
import { ReceiptThumb } from '../../src/ui/ReceiptThumb';
import { ConflictView } from '../../src/ui/ConflictView';
import { txTypeLabelKey } from '../../src/transactions/txTypes';
import { endsReady, rewireForType, type TxEnds } from '../../src/transactions/changeType';
import { sharedWithFromTags, withSharedWith } from '../../src/transactions/sharedWith';

type TxType = 'withdrawal' | 'deposit' | 'transfer';

function parseTags(tagsJson: string): string[] {
  try {
    const tags: unknown = JSON.parse(tagsJson);
    return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export default function TransactionDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const db = useDb();
  const { t: tr } = useTranslation();
  const { data: rows } = useLiveQuery(
    db.select().from(cachedTransactions).where(eq(cachedTransactions.groupId, groupId)),
    [groupId],
  );
  const row = rows?.[0];

  if (!row)
    return (
      <Screen bottom>
        <AppBar title={tr('transaction.title')} />
      </Screen>
    );
  // Mounted once the row is known, so the editor below never has to re-narrow it.
  return <TransactionEditor row={row} />;
}

type CachedRow = typeof cachedTransactions.$inferSelect;

function TransactionEditor({ row }: { row: CachedRow }) {
  const groupId = row.groupId;
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();

  // The kinds that can touch one transaction; account edits never do.
  const { data: outbox } = useLiveQuery(
    db.select().from(outboxOperations).where(ne(outboxOperations.kind, 'update_account')),
  );
  // An old transaction can point at an account since made inactive — look its name up across
  // every account for display, but only offer active ones when picking a new one.
  const allAccountRows = useAssetAccounts({ includeInactive: true, includeLiabilities: true });
  const allAssetAccounts = allAccountRows ?? [];
  const activeAssetAccounts = useAssetAccounts({ includeLiabilities: true }) ?? [];
  const categories = useCategories();
  const sharedPeople = useSharedPeople();
  // undefined until each table's first read lands: the screen shows a spinner for what it
  // can't resolve yet, not "—" or a currency code standing in for its symbol.
  const budgetRows = useBudgetRows();
  const budgets = budgetRows ?? [];
  const currencyRows = useCurrencyRows();
  const currencies = currencyRows ?? [];
  const currenciesLoading = currencyRows === undefined;
  const referenceLoading =
    currenciesLoading || allAccountRows === undefined || budgetRows === undefined;
  // The photo this transaction was captured from, if the phone still has it (kept a while after
  // upload, see pruneUploadedReceiptImages): the preview while FF3's own list is unavailable.
  const { data: sourceItems } = useLiveQuery(
    db
      .select({ path: inboxItems.receiptImagePath })
      .from(inboxItems)
      .where(eq(inboxItems.ff3GroupId, groupId)),
    [groupId],
  );
  const localReceiptPath = sourceItems?.find((i) => !!i.path)?.path ?? null;

  // Receipt status: uploads still queued here, and what FF3 already holds. Refetched whenever the
  // number of queued uploads changes, so a finished upload shows up without leaving the screen.
  const queued = queuedAttachments(outbox ?? [], row.journalId);
  const deletedAttachmentIds = queuedAttachmentDeletes(outbox ?? [], row.journalId);
  const attachments = useQuery({
    queryKey: ['journal-attachments', groupId, row.journalId, queued.length],
    queryFn: async () => {
      const client = await getClient(db);
      return client ? fetchJournalAttachments(client, groupId, row.journalId) : null;
    },
    retry: false,
  });

  // A split transaction cached before every split was kept: read it again from FF3.
  const cachedSplits = readSplits(row.splitsJson);
  const splitsRefresh = useQuery({
    queryKey: ['refresh-group', groupId],
    enabled: row.splitCount > 1 && !cachedSplits,
    queryFn: async () => {
      const client = await getClient(db);
      return client ? refreshCachedGroup(db, client, groupId) : false;
    },
    retry: false,
  });

  const lookupType = row.type === 'withdrawal' || row.type === 'deposit' ? row.type : undefined;
  const histories = useMerchantHistories(lookupType, { enabled: !!lookupType });

  const [changes, setChanges] = useState<EditChanges>({});
  const [menuOpen, setMenuOpen] = useState(false);
  /** The photo open full screen: its file:// uri, and its FF3 attachment id when FF3 holds it. */
  const [photo, setPhoto] = useState<{ uri: string; attachmentId: string | null } | null>(null);
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
  // The keypad always opens on an amount that is already there. False until the first key of this
  // visit lands: a digit then replaces the whole sum, ⌫ keeps and edits it (amountInput.ts).
  const keypadTouched = useRef(false);
  const [textFor, setTextFor] = useState<number | 'title' | 'description' | null>(null);
  const [payeeFor, setPayeeFor] = useState<number | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);

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

  const currency = currencyOf(currencies, row.currencyCode);
  const dp = currency.decimalPlaces;
  // An edit saved earlier but not yet in FF3: shown as the current values (under this screen's
  // own unsaved `changes`), so reopening a just-saved transaction doesn't show the old ones.
  // Save still sends only this screen's `changes`; the queued edit replays first.
  const pendingEdit = pendingEdits(outbox ?? []).byGroup.get(row.groupId);
  const shown: EditChanges = { ...pendingEdit?.changes, ...changes };
  // This visit's kind, not the cached one: changing it is an edit like any other, so every branch
  // below (which end is the payee, what a split carries, what Save sends) follows from it.
  const type = (shown.type as TxType | undefined) ?? (row.type as TxType);

  // Receipt thumbnails: uploads still queued, from the phone, then what FF3 holds, fetched with the
  // API token like any request (src/receipt/journalAttachments.ts).
  const previews = receiptPreviews({
    queuedPaths: queued.map((q) => q.receiptImagePath).filter((p): p is string => !!p),
    capturedPath: localReceiptPath,
    remote: attachments.data,
    deletedIds: deletedAttachmentIds,
  });
  // The receipt card's rows in order: what FF3 holds, what is still uploading, then "Attach".
  const receiptRows: {
    key: string;
    value: string;
    tone?: 'danger';
    onPress?: () => void;
  }[] = [
    ...(attachments.data ?? [])
      .filter((a) => !deletedAttachmentIds.includes(a.id))
      .map((a) => ({ key: a.id, value: `📎 ${a.filename}` })),
    ...queued.map((q) => ({
      key: q.opId,
      value:
        q.status === 'failed'
          ? q.lastError
            ? tr('transaction.uploadFailedWith', { error: q.lastError })
            : tr('transaction.uploadFailed')
          : tr('transaction.uploading'),
      tone: q.status === 'failed' ? ('danger' as const) : undefined,
    })),
    {
      key: 'attach',
      value:
        attachments.data?.length || queued.length
          ? tr('transaction.attachAnother')
          : tr('receipt.attachTitle'),
      onPress: () =>
        router.push({ pathname: '/receipt', params: { attachToJournalId: row.journalId } }),
    },
  ];
  const effectiveAmount = shown.amount ?? row.amount;
  // `!== undefined`, like the budget and category below: a kind change empties the end it can't
  // answer for, and `null` there means "the user still has to pick one" — not "fall back to the
  // account this was before", which is the account the new kind can't use.
  const effectiveSourceId =
    shown.source_id !== undefined
      ? shown.source_id
      : (row.sourceId ?? allAssetAccounts.find((a) => a.name === row.sourceName)?.id ?? null);
  const effectiveDestinationId =
    shown.destination_id !== undefined
      ? shown.destination_id
      : (row.destinationId ??
        allAssetAccounts.find((a) => a.name === row.destinationName)?.id ??
        null);
  // A cleared budget or category is `null` (not absent): it must not fall back to the cached value.
  const effectiveBudgetId =
    shown.budget_id !== undefined
      ? shown.budget_id
      : (row.budgetId ?? budgets.find((b) => b.name === row.budgetName)?.id ?? null);
  const effectiveCategoryName =
    shown.category_name !== undefined ? shown.category_name : (row.categoryName ?? null);
  const effectiveDate = shown.date ? new Date(shown.date) : new Date(row.date);
  const effectiveNotes = shown.notes ?? row.notes ?? null;
  const effectiveTags = shown.tags ?? parseTags(row.tagsJson);
  // The payee of an expense is its destination, the payer of an income its source; a transfer has
  // neither. A new one is queued by name and turned into an id when it's sent (src/sync/accountIds.ts).
  const effectivePayee =
    type === 'withdrawal'
      ? shown.destination_name !== undefined
        ? shown.destination_name
        : row.destinationName
      : type === 'deposit'
        ? shown.source_name !== undefined
          ? shown.source_name
          : row.sourceName
        : null;
  const effectiveSharedWith = sharedWithFromTags(effectiveTags);
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
    const destinationId = shown.destination_id ?? row.destinationId ?? null;
    // A payee picked on this screen has only a name: the old payee's id must not come along.
    const payeeRenamed =
      (type === 'withdrawal' && shown.destination_name !== undefined) ||
      (type === 'deposit' && shown.source_name !== undefined);
    return {
      journalId: row.journalId,
      amount: effectiveAmount,
      description: shown.description ?? row.description,
      sourceId: type === 'deposit' && payeeRenamed ? null : effectiveSourceId,
      sourceName: shown.source_name ?? row.sourceName,
      destinationId:
        type === 'withdrawal' ? (payeeRenamed ? null : destinationId) : effectiveDestinationId,
      destinationName: shown.destination_name ?? row.destinationName,
      categoryName: effectiveCategoryName,
      budgetId: effectiveBudgetId,
      notes: effectiveNotes,
      tags: effectiveTags,
      internalReference: cachedSplits?.[0]?.internalReference ?? null,
    };
  }

  /** The two ends as they stand, for changeType.ts. */
  const ends: TxEnds = {
    sourceId: effectiveSourceId,
    sourceName: type === 'deposit' ? effectivePayee : (shown.source_name ?? row.sourceName ?? null),
    destinationId: effectiveDestinationId,
    destinationName:
      type === 'withdrawal'
        ? effectivePayee
        : (shown.destination_name ?? row.destinationName ?? null),
  };
  // Judged only once this visit has touched an end: a cached row that reached the phone without
  // an account id must not have its Save disabled over something the user never changed.
  const endsTouched = (
    ['type', 'source_id', 'source_name', 'destination_id', 'destination_name'] as const
  ).some((key) => key in changes);
  const ready = !endsTouched || endsReady(type, ends);

  function handleDetailChange(change: Partial<DetailRowsValue>) {
    setChanges((prev) => {
      const next = { ...prev };
      // The kind decides which sort of account belongs at each end, so it rewires both of them;
      // an end it can't answer for is emptied and Save waits for it (src/transactions/changeType.ts).
      if (change.type && change.type !== type)
        Object.assign(next, rewireForType(type, change.type, ends));
      if ('categoryName' in change) next.category_name = change.categoryName ?? null;
      if ('sourceAccountId' in change) next.source_id = change.sourceAccountId ?? undefined;
      if ('destinationAccountId' in change)
        next.destination_id = change.destinationAccountId ?? undefined;
      if ('budgetId' in change) next.budget_id = change.budgetId ?? null;
      if ('notes' in change) next.notes = change.notes ?? undefined;
      if ('sharedWith' in change)
        next.tags = withSharedWith(effectiveTags, change.sharedWith ?? null);
      return next;
    });
  }

  function setPayee(name: string) {
    setChanges((prev) =>
      type === 'deposit'
        ? { ...prev, source_name: name, source_id: undefined }
        : { ...prev, destination_name: name, destination_id: undefined },
    );
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

  /** The same rule as the draft screen's, writing into this screen's split state. */
  function place(next: EditableSplit[], nextTotal: string, exclude?: number) {
    placeLeftover(
      next.map((s) => s.amount),
      nextTotal,
      dp,
      {
        write: (amounts) => setEdited(next.map((s, i) => ({ ...s, amount: amounts[i]! }))),
        ask: (delta) => setAllocation({ mode: { kind: 'leftover', delta, exclude }, base: next }),
      },
      exclude,
    );
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
    if (next.length === 1 && baseSplits.length <= 1) {
      const remaining = next[0]!;
      setEdited(null);
      setTotalEdit(null);
      setTitleEdit(null);
      setRemoved([]);
      setPage(0);
      setChanges((prev) => ({
        ...prev,
        amount: total,
        description: remaining.description,
        category_name: remaining.categoryName,
        notes: remaining.notes,
        tags: remaining.tags,
        source_id: remaining.sourceId ?? undefined,
        source_name: remaining.sourceName ?? undefined,
        destination_id: remaining.destinationId ?? undefined,
        destination_name: remaining.destinationName ?? undefined,
        budget_id: remaining.budgetId ?? undefined,
      }));
      return;
    }
    // One split left holds the whole total; with more, split 1 takes the removed amount.
    if (next.length === 1) next[0] = { ...next[0]!, amount: total };
    setEdited(next);
    setPage(Math.max(0, index - 1));
    place(next, total);
  }

  function closeKeypad() {
    const target = keypadFor;
    setKeypadFor(null);
    if (target === 'total') place(splits, total);
    else if (typeof target === 'number') {
      if (splits.length === 1) setTotalEdit(splits[0]!.amount);
      else place(splits, total, target);
    }
  }

  // What the screen showed before this visit's edits: the cache, under any queued edit. Save
  // compares against it by value, so touching a field without changing it queues nothing.
  const baseline: EditChanges = {
    type: row.type as TxType,
    amount: row.amount,
    date: row.date,
    description: row.description,
    category_name: row.categoryName ?? undefined,
    notes: row.notes ?? undefined,
    tags: parseTags(row.tagsJson),
    source_id: row.sourceId ?? allAssetAccounts.find((a) => a.name === row.sourceName)?.id,
    source_name: row.sourceName ?? undefined,
    destination_name: row.destinationName ?? undefined,
    destination_id:
      row.destinationId ?? allAssetAccounts.find((a) => a.name === row.destinationName)?.id,
    budget_id: row.budgetId ?? budgets.find((b) => b.name === row.budgetName)?.id,
    ...pendingEdit?.changes,
  };

  const onSave = act(tr('common.save'), async () => {
    if (splitMode) {
      const date = effectiveDate.toISOString();
      const payloadSplits = toPayloadSplits(splits, {
        type,
        date,
        currencyCode: row.currencyCode,
      });
      const baseTotal =
        (pendingEdit?.splits ? pendingEdit.changes.amount : undefined) ?? row.amount;
      const baseTitle = pendingEdit?.groupTitle ?? row.description;
      const dirty =
        removed.length > 0 ||
        !sameAmount(total, baseTotal) ||
        groupTitle !== baseTitle ||
        Object.keys(changedFields({ date: changes.date }, { date: baseline.date })).length > 0 ||
        !sameSplits(
          payloadSplits,
          toPayloadSplits(baseSplits, { type, date, currencyCode: row.currencyCode }),
        );
      if (!dirty) {
        router.back();
        return;
      }
      if (rest !== 0n) return;
      await queueSplitEdit(db, {
        groupId: row.groupId,
        transactionJournalId: row.journalId,
        expectedUpdatedAt: row.updatedAt,
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
      return;
    }
    // A kind change with an end still to pick would be a 422; the button is disabled for it.
    if (!ready) return;
    const toSend = changedFields(changes, baseline);
    // FF3 requires a description: one cleared out is left as it was rather than refused with a 422.
    if ('description' in toSend && !toSend.description?.trim()) delete toSend.description;
    if (Object.keys(toSend).length === 0) {
      router.back();
      return;
    }
    await queueTransactionEdit(db, row, toSend);
    router.back();
  });
  const saving = act.pending(tr('common.save'));

  const onDuplicate = act(tr('transaction.duplicate'), async () => {
    setMenuOpen(false);
    const id = await duplicateTransaction(db, row);
    router.push(`/draft/${id}`);
  });

  // A photo Firefly III holds (#69). Queued like every other write, and confirmed first: FF3
  // keeps no copy of a deleted attachment.
  const deletePhoto = act(tr('common.delete'), async () => {
    const attachmentId = photo?.attachmentId;
    if (!attachmentId) return;
    const ok = await confirmDestructive(
      tr('transaction.deletePhotoTitle'),
      tr('common.delete'),
      tr('transaction.deletePhotoBody'),
    );
    if (!ok) return;
    setPhoto(null);
    await deleteJournalAttachment(db, { attachmentId, transactionJournalId: row.journalId });
  });

  const onDelete = act(tr('common.delete'), async () => {
    setMenuOpen(false);
    if (!(await confirmDestructive(tr('transaction.deleteTitle'), tr('common.delete')))) return;
    await queueTransactionDelete(db, row);
    router.back();
  });

  if (conflictOp)
    return (
      <ConflictView
        row={row}
        operation={conflictOp}
        accounts={allAssetAccounts}
        budgets={budgets}
        currency={currency}
      />
    );

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
      sharedWith: sharedWithFromTags(split.tags),
    };
  }

  const payeeOf = (split: EditableSplit) =>
    type === 'deposit' ? split.sourceName : split.destinationName;

  function renderSplitPage(index: number) {
    const split = splits[index]!;
    return (
      <SplitPage
        amount={split.amount}
        currency={currency}
        type={type}
        description={split.description}
        payee={payeeOf(split)}
        onAmountPress={() => openKeypad(index)}
        onDescriptionPress={() => setTextFor(index)}
        onPayeePress={() => setPayeeFor(index)}
        onRemove={splits.length > 1 ? () => removeSplit(index) : undefined}
      >
        <DetailRows
          value={splitDetailValue(split)}
          onChange={(change) => handleSplitDetailChange(index, change)}
          onDatePress={openDatePicker}
          accounts={allAssetAccounts}
          pickableAccounts={activeAssetAccounts}
          currencies={currencies}
          sharedPeople={sharedPeople}
          categories={categories}
          budgets={budgets}
          loading={referenceLoading}
        />
      </SplitPage>
    );
  }

  // `keypadFor === 0` is the first amount, which on a plain transaction is the only one.
  const keypadValue =
    keypadFor === 'total'
      ? total
      : keypadFor === 0 && !splitMode
        ? effectiveAmount
        : typeof keypadFor === 'number'
          ? (splits[keypadFor]?.amount ?? '0')
          : effectiveAmount;

  function openKeypad(target: number | 'total') {
    keypadTouched.current = false;
    setKeypadFor(target);
  }

  function typeAmountDigit(key: KeypadKey) {
    const first = !keypadTouched.current;
    keypadTouched.current = true;
    const type = (current: string) =>
      first ? applyFirstKey(current, key, dp) : applyDigit(current, key, dp);
    if (keypadFor === 'total') {
      setTotalEdit(type(total));
      return;
    }
    if (typeof keypadFor !== 'number') return;
    // A plain transaction has no splits to edit — writing one would turn it into a split.
    if (keypadFor === 0 && !splitMode) {
      setChanges((prev) => ({
        ...prev,
        amount: type(prev.amount ?? pendingEdit?.changes.amount ?? row.amount),
      }));
      return;
    }
    editSplit(keypadFor, { amount: type(splits[keypadFor]!.amount) });
  }

  return (
    <Screen bottom>
      <View style={{ flex: 1 }}>
        <AppBar
          title={txTypeLabelKey(type) ? tr(txTypeLabelKey(type)!) : type}
          subtitle={
            pendingEdit
              ? pendingEdit.status === 'queued'
                ? tr('transaction.changesQueued')
                : tr('transaction.changesNotSent')
              : tr('transaction.syncedAgo', { time: relativeTime(row.syncedAt) })
          }
          left={<CloseButton onPress={() => router.back()} />}
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
                onTotalPress={() => openKeypad('total')}
                onReassign={() =>
                  askLeftover(
                    splits.map((s) => s.amount),
                    total,
                    dp,
                    (delta) => setAllocation({ mode: { kind: 'leftover', delta }, base: splits }),
                  )
                }
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
                <Pressable onPress={() => openKeypad(0)} disabled={splitsLoading}>
                  <Money
                    amount={effectiveAmount}
                    currency={currency}
                    type={type}
                    size="title"
                    loading={currenciesLoading}
                  />
                </Pressable>
                {splitsLoading && (
                  <Text style={[t.type.label, { color: t.color.textMuted }]}>
                    {splitsRefresh.isError || splitsRefresh.data === false
                      ? tr('splits.loadFailed')
                      : tr('splits.loading')}
                  </Text>
                )}
                <Pressable
                  onPress={() => setTextFor('description')}
                  accessibilityRole="button"
                  accessibilityLabel={tr('fields.description')}
                >
                  <Text
                    style={[
                      t.type.heading,
                      { color: t.color.text, marginTop: t.space.xs, textAlign: 'center' },
                    ]}
                    numberOfLines={2}
                  >
                    {shown.description ?? row.description}
                  </Text>
                </Pressable>
              </View>
              <DetailRows
                value={detailValue}
                onChange={handleDetailChange}
                onDatePress={openDatePicker}
                payee={{ name: effectivePayee, onPress: () => setPayeeFor(0) }}
                // A split transaction's kind can't be changed here: every split has its own ends
                // to rewire, and the pager edits them one page at a time.
                typeEditable
                accounts={allAssetAccounts}
                pickableAccounts={activeAssetAccounts}
                currencies={currencies}
                sharedPeople={sharedPeople}
                categories={categories}
                budgets={budgets}
                loading={referenceLoading}
              />
            </>
          )}
          <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
            {previews.map((p) => (
              <ReceiptThumb
                key={p.key}
                preview={p}
                // Only a photo FF3 holds (one downloaded with a Bearer header) can be deleted
                // there; a local one still waiting to upload goes by cancelling the upload.
                onOpen={(uri) => setPhoto({ uri, attachmentId: p.source.headers ? p.key : null })}
              />
            ))}
            {/* One list, so only the first row carries the "Receipt" label and the top border. */}
            <View>
              {receiptRows.map((r, i) => (
                <Row
                  key={r.key}
                  first={i === 0}
                  label={i === 0 ? tr('draft.receipt') : ''}
                  value={r.value}
                  tone={r.tone}
                  chevron={r.onPress ? true : undefined}
                  onPress={r.onPress}
                />
              ))}
            </View>
          </Card>
        </ScrollView>

        {!ready && (
          <Text
            style={[
              t.type.label,
              { color: t.color.warn, paddingHorizontal: t.space.lg, textAlign: 'center' },
            ]}
          >
            {type === 'transfer' ? tr('transaction.pickBothAccounts') : tr('transaction.pickPayee')}
          </Text>
        )}
        <View style={{ padding: t.space.lg, flexDirection: 'row', gap: t.space.sm }}>
          <Button
            title={saving ? tr('common.saving') : tr('common.save')}
            onPress={onSave}
            disabled={saving || rest !== 0n || !ready}
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
        visible={keypadFor !== null}
        onClose={closeKeypad}
        title={keypadFor === 'total' ? tr('splits.total') : tr('fields.amount')}
      >
        <Money
          amount={keypadValue}
          currency={currency}
          type={type}
          size="display"
          loading={currenciesLoading}
        />
        <Keypad
          compact
          onDigit={typeAmountDigit}
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
              : textFor === 'description'
                ? (shown.description ?? row.description)
                : typeof textFor === 'number'
                  ? (splits[textFor]?.description ?? '')
                  : ''
          }
          onChangeText={(value) => {
            if (textFor === 'title') setTitleEdit(value);
            else if (textFor === 'description')
              setChanges((prev) => ({ ...prev, description: value }));
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
          if (!splitMode) {
            setPayee(h.displayName);
            return;
          }
          editSplit(
            payeeFor,
            type === 'deposit'
              ? { sourceName: h.displayName, sourceId: null }
              : { destinationName: h.displayName, destinationId: null },
          );
        }}
        onCreateNew={(text) => {
          if (payeeFor === null) return;
          if (!splitMode) {
            setPayee(text);
            return;
          }
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
      <PhotoViewer
        uri={photo?.uri ?? null}
        onClose={() => setPhoto(null)}
        onDelete={photo?.attachmentId ? deletePhoto : undefined}
      />
    </Screen>
  );
}
