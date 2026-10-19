// Draft review (design §6.3) — one legible card for both a manual draft and a receipt. A split
// entry (Split, or a duplicated split transaction) shows its tracked total and one page per split.
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useShake } from '../../src/ui/feedback';
import { useLocalSearchParams, router } from 'expo-router';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useBudgetRows, useCategories, useCurrencyRows } from '../../src/db/useReferenceData';
import { pickDateTime } from '../../src/ui/pickDate';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
// prettier-ignore
import { Button, Card, Chip, IconButton, ListRow, ModalHeader, Money, Screen, SectionHeader, Segmented, Sheet, StatusPill, StickyFooter, Tile } from '../../src/ui/kit';
import { rewireForType, type TxEnds } from '../../src/transactions/changeType';
import { DetailRows, type DetailRowsValue } from '../../src/ui/DetailRows';
import { PayeeSheet } from '../../src/ui/PayeeSheet';
import { AmountSheet } from '../../src/ui/AmountSheet';
import { TextField } from '../../src/ui/TextField';
import { SplitPager } from '../../src/ui/SplitPager';
import { SplitPage } from '../../src/ui/SplitPage';
import { PhotoViewer } from '../../src/ui/PhotoViewer';
import {
  AllocationSheet,
  type AllocationMode,
  type AllocationResult,
} from '../../src/ui/AllocationSheet';
import { currencyOf, currencySymbol, formatMoney, fxCaption } from '../../src/ui/money';
import { pickableCurrencies } from '../../src/ui/currencies';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { haptics } from '../../src/ui/haptics';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { inboxItems, outboxOperations } from '../../src/db/schema';
import { useSharedPeople } from '../../src/lookup/sharedPeople';
import { useRecentTags } from '../../src/lookup/recentTags';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import { confirmInboxItem } from '../../src/inbox/createManualEntry';
import { discardOperation } from '../../src/sync/outbox';
import { requestSync } from '../../src/sync/syncTrigger';
import { getClient } from '../../src/api/ff3/session';
import { alertDiscardOutcome } from '../../src/inbox/discardAlert';
import { askPhotoSource, pickPhoto } from '../../src/receipt/pickPhoto';
import {
  updateDraft,
  deleteInboxItem,
  attachReceiptImage,
  removeReceiptImage,
  retryErroredItem,
} from '../../src/inbox/updateDraft';
import { draftReadiness } from '../../src/inbox/readiness';
import { draftAccountCurrency, needsForeignAmount } from '../../src/inbox/fx';
import { unsureFields } from '../../src/inbox/unsure';
import { useMerchantHistories } from '../../src/lookup/useMerchantHistories';
import { confirmDestructive } from '../../src/ui/confirm';
import { reportErrors } from '../../src/ui/reportError';
import { rememberPayeeAlias, removePayeeAlias } from '../../src/lookup/aliases';
import { Snackbar, type SnackbarEntry } from '../../src/ui/Snackbar';
import { generateId } from '../../src/utils/id';
import type { Draft, DraftSplit } from '../../src/inbox/draft';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { missingLabel } from '../../src/ui/readinessLabel';
import { appLocale } from '../../src/i18n';
import { readDraft } from '../../src/inbox/draftJson';
import type { InboxItemRow } from '../../src/inbox/useInboxSections';
import { useAction } from '../../src/ui/useAction';
import {
  addSplit,
  draftAmounts,
  draftTotal,
  isSplitDraft,
  patchExtraSplit,
  removeExtraSplit,
  withAmounts,
} from '../../src/inbox/draftSplits';
import { absorb, leftover } from '../../src/splits/allocate';
import { askLeftover, placeLeftover, type LeftoverHandlers } from '../../src/splits/placeLeftover';

import { divideDecimal } from '../../src/api/ff3/decimal';

export default function DraftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const { t: tr } = useTranslation();
  const { data: rows } = useLiveQuery(db.select().from(inboxItems).where(eq(inboxItems.id, id)), [
    id,
  ]);
  const row = rows?.[0];

  if (!row) {
    return (
      <Screen bottom modal>
        <ModalHeader title={tr('draft.title')} onClose={() => router.back()} />
      </Screen>
    );
  }
  // Mounted once the row is known, so the editor below never has to re-narrow it.
  return <DraftEditor row={row} />;
}

export function DraftEditor({ row }: { row: InboxItemRow }) {
  const id = row.id;
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const { shake } = useShake(); // the visual twin of the warn haptic

  const accountRows = useAssetAccounts({ includeLiabilities: true });
  const assetAccounts = accountRows ?? [];
  const categories = useCategories();
  const sharedPeople = useSharedPeople();
  const recentTags = useRecentTags();
  // undefined until each table's first read lands: a spinner stands in for "—" and for the
  // currency code that would otherwise replace its symbol.
  const budgetRows = useBudgetRows();
  const budgets = budgetRows ?? [];
  const currencyRows = useCurrencyRows();
  const currencies = currencyRows ?? [];
  const currenciesLoading = currencyRows === undefined;
  const referenceLoading =
    currenciesLoading || accountRows === undefined || budgetRows === undefined;

  // A confirmed entry whose create is still waiting in the queue can be taken back — the same
  // rule as Undo: only while it is `pending`, never once sending started.
  const { data: ops } = useLiveQuery(
    db.select().from(outboxOperations).where(eq(outboxOperations.inboxItemId, id)),
    [id],
  );
  const pendingCreate =
    (ops ?? []).find((op) => op.kind === 'create_transaction' && op.status !== 'in_flight') ?? null;
  // Any entry can carry a photo: it is uploaded to FF3 right after the transaction is created
  // (src/sync/outbox.ts queues the upload when the create lands).
  const attachPhoto = act(tr('capture.receiptPhoto'), async () => {
    const source = await askPhotoSource();
    if (!source) return;
    const photo = await pickPhoto(source);
    if (!photo) return;
    await attachReceiptImage(db, id, photo.uri);
  });
  const cancelSending = act(tr('draft.cancelSending'), async () => {
    if (!pendingCreate) return;
    // Back to the Inbox as a draft (a receipt as `parsed`, so the photo isn't read again); a create
    // that was already attempted is looked up in FF3 first.
    alertDiscardOutcome(await discardOperation(db, pendingCreate.id, () => getClient(db)));
  });
  const draft: Draft = readDraft(row.draftJson);

  const histories = useMerchantHistories(draft.type === 'transfer' ? undefined : draft.type);

  // One open at a time (#21); the split sheets below carry which split they're for.
  const [sheet, setSheet] = useState<'payee' | 'menu' | 'photo' | 'currency' | null>(null);
  const closeSheet = () => setSheet(null);
  const [snackbar, setSnackbar] = useState<SnackbarEntry | null>(null);
  const dismissSnackbar = useCallback(() => setSnackbar(null), []);
  // Split editing (page 0 is the draft's own fields, 1..N its extraSplits).
  const [page, setPage] = useState(0);
  const [allocation, setAllocation] = useState<AllocationMode | null>(null);
  const [keypadFor, setKeypadFor] = useState<number | 'total' | 'foreign' | null>(null);
  const [textFor, setTextFor] = useState<number | 'title' | null>(null);
  const [extraPayeeFor, setExtraPayeeFor] = useState<number | null>(null);

  const readOnly = row.state === 'confirmed' || row.state === 'synced';
  const payeeName = draft.type === 'deposit' ? draft.sourceName : draft.destinationName;
  const aliasCaption =
    draft.payeeReadAs && draft.payeeReadAs !== payeeName
      ? tr('draft.viaAlias', { alias: draft.payeeReadAs })
      : null;

  const currency = currencyOf(currencies, draft.currencyCode);
  const dp = currency.decimalPlaces;
  // FX (design §6.2), as on Capture: a draft read in a currency the account doesn't hold has to
  // say what the account was charged, or FF3 books the receipt's number in the account's currency.
  const accountCurrencyCode = draftAccountCurrency(draft, (id) =>
    id ? assetAccounts.find((a) => a.id === id)?.currencyCode : undefined,
  );
  const showFx = needsForeignAmount(accountCurrencyCode, draft.currencyCode);
  // Against the tracked total, not split 1's amount: a split entry is charged, and converted, as
  // a whole (#129).
  const impliedRate =
    draft.foreignAmount && draft.foreignAmount !== '0' && draftTotal(draft) !== '0'
      ? divideDecimal(draftTotal(draft), draft.foreignAmount, 2)
      : null;
  const accountCurrency = currencyOf(currencies, accountCurrencyCode ?? '');
  const readiness = draftReadiness(draft, accountCurrencyCode);
  // What the receipt reader wasn't sure about: marked amber until the user sets it (#120).
  const unsure = readOnly ? [] : unsureFields(draft);
  const unsureRows = new Set(unsure.filter((f) => f !== 'amount'));
  const splitMode = isSplitDraft(draft);
  const extras = draft.extraSplits ?? [];
  const amounts = draftAmounts(draft);
  const total = draftTotal(draft);
  const rest = splitMode ? leftover(total, amounts, dp) : 0n;
  const pageIndex = Math.min(page, extras.length);
  const chargedLabel = tr(splitMode ? 'draft.accountChargedTotal' : 'draft.accountCharged');

  // A wrong photo goes, the fields it was read into stay (#69). A draft with nothing in it but
  // the photo says so, rather than being left as a card nobody can confirm.
  const removePhoto = act(tr('capture.removePhoto'), async () => {
    const empty = !draft.description.trim() && readiness.missing.includes('amount');
    const ok = await confirmDestructive(
      tr('draft.removePhotoTitle'),
      tr('capture.removePhoto'),
      empty ? tr('draft.removePhotoEmpty') : undefined,
    );
    if (!ok) return;
    closeSheet();
    await removeReceiptImage(db, id);
  });

  // Not awaited, but never silent: a failed write is logged and shown instead of becoming an
  // unhandled rejection.
  function patch(fields: Partial<Draft>) {
    // Changing an account or the currency invalidates whatever conversion was entered for the old
    // pair, so it is dropped and asked for again — otherwise a stale figure is sent as the amount
    // the account was charged. Here rather than in each handler, so every writer is covered.
    const next =
      'sourceId' in fields || 'destinationId' in fields || 'currencyCode' in fields
        ? { foreignAmount: undefined, foreignCurrencyCode: undefined, ...fields }
        : fields;
    void reportErrors(
      tr('common.save'),
      () => updateDraft(db, id, next),
      (message) => setSnackbar({ id: generateId(), message }),
    );
  }

  const choosePayee = act(tr('capture.payee'), async (d: Draft, name: string, isNew: boolean) => {
    const raw = d.payeeReadAs ?? (d.isNewPayee ? payeeName : undefined);
    const learned = raw ? await rememberPayeeAlias(db, raw, name) : false;
    patch(
      d.type === 'deposit'
        ? {
            sourceName: name,
            sourceId: undefined,
            isNewPayee: isNew,
            payeeReadAs: learned ? raw : undefined,
          }
        : {
            destinationName: name,
            destinationId: undefined,
            isNewPayee: isNew,
            payeeReadAs: learned ? raw : undefined,
          },
    );
    if (!learned || !raw) return;
    setSnackbar({
      id: generateId(),
      message: tr('draft.willBookTo', { raw, name }),
      actionLabel: tr('common.undo'),
      onAction: () => {
        void removePayeeAlias(db, raw);
      },
    });
  });

  function handleDetailChange(change: Partial<DetailRowsValue>) {
    const draftPatch: Partial<Draft> = {};
    if ('categoryName' in change) draftPatch.categoryName = change.categoryName ?? undefined;
    if ('sourceAccountId' in change) {
      draftPatch.sourceId = change.sourceAccountId ?? undefined;
      if (
        (!draft.amount || draft.amount === '0') &&
        change.sourceAccountId &&
        draft.type !== 'deposit'
      ) {
        const acc = assetAccounts.find((a) => a.id === change.sourceAccountId);
        if (acc?.currencyCode) {
          draftPatch.currencyCode = acc.currencyCode;
        }
      }
    }
    if ('destinationAccountId' in change) {
      draftPatch.destinationId = change.destinationAccountId ?? undefined;
      if (
        (!draft.amount || draft.amount === '0') &&
        change.destinationAccountId &&
        draft.type === 'deposit'
      ) {
        const acc = assetAccounts.find((a) => a.id === change.destinationAccountId);
        if (acc?.currencyCode) {
          draftPatch.currencyCode = acc.currencyCode;
        }
      }
    }
    if ('budgetId' in change) draftPatch.budgetId = change.budgetId ?? undefined;
    if ('notes' in change) draftPatch.notes = change.notes ?? undefined;
    if ('tags' in change) draftPatch.extraTags = change.tags ?? [];
    if ('sharedWith' in change) draftPatch.sharedWith = change.sharedWith ?? undefined;
    patch(draftPatch);
  }

  // Split 2..N: the accounts every split shares go to the draft itself, the rest to the split.
  function handleExtraDetailChange(index: number, change: Partial<DetailRowsValue>) {
    const own: Partial<DraftSplit> = {};
    const shared: Partial<Draft> = {};
    if ('categoryName' in change) own.categoryName = change.categoryName ?? undefined;
    if ('budgetId' in change) own.budgetId = change.budgetId ?? undefined;
    if ('notes' in change) own.notes = change.notes ?? undefined;
    if ('tags' in change) own.extraTags = change.tags ?? [];
    if ('sharedWith' in change) own.sharedWith = change.sharedWith ?? undefined;
    if ('sourceAccountId' in change) shared.sourceId = change.sourceAccountId ?? undefined;
    if ('destinationAccountId' in change)
      shared.destinationId = change.destinationAccountId ?? undefined;
    patch({
      ...shared,
      ...(Object.keys(own).length ? patchExtraSplit(draft, index - 1, own) : {}),
    });
  }

  function openDatePicker() {
    pickDateTime(new Date(draft.date), (picked) => patch({ date: picked.toISOString() }));
  }

  function handleTypeChange(newType: 'withdrawal' | 'deposit' | 'transfer') {
    if (newType === draft.type) return;
    const ends: TxEnds = {
      sourceId: draft.sourceId ?? null,
      sourceName: draft.type === 'deposit' ? (draft.sourceName ?? null) : null,
      destinationId: draft.destinationId ?? null,
      destinationName: draft.type === 'withdrawal' ? (draft.destinationName ?? null) : null,
    };
    const rewired = rewireForType(draft.type, newType, ends);
    patch({
      type: newType,
      sourceId: rewired.source_id ?? undefined,
      destinationId: rewired.destination_id ?? undefined,
      sourceName: rewired.source_name ?? undefined,
      destinationName: rewired.destination_name ?? undefined,
      budgetId: newType === 'transfer' ? undefined : draft.budgetId,
    });
  }

  const handleConfirm = act(tr('inbox.confirm'), async () => {
    if (!readiness.ready) {
      haptics.warn();
      shake();
      return;
    }
    await confirmInboxItem(db, id);
    haptics.tick();
    router.back();
  });
  const confirming = act.pending(tr('inbox.confirm'));

  const retryError = act(tr('inbox.retry'), async () => {
    await retryErroredItem(db, id);
    requestSync();
  });

  const handleDeleteDraft = act(tr('common.delete'), async () => {
    closeSheet();
    if (
      !(await confirmDestructive(
        tr('draft.deleteTitle'),
        tr('common.delete'),
        tr('draft.deleteBody'),
      ))
    )
      return;
    await deleteInboxItem(db, id);
    router.back();
  });

  const leftoverHandlers: LeftoverHandlers = {
    write: (next) => patch(withAmounts(draft, next)),
    ask: (delta, exclude) => setAllocation({ kind: 'leftover', delta, exclude }),
  };
  const place = (nextAmounts: string[], nextTotal: string, exclude?: number) =>
    placeLeftover(nextAmounts, nextTotal, dp, leftoverHandlers, exclude);

  function onAllocated(result: AllocationResult) {
    if (!allocation) return;
    if (allocation.kind === 'newSplit' && result.newAmount) {
      patch(addSplit(draft, result.amounts, result.newAmount));
      setPage(extras.length + 1);
    } else {
      patch(withAmounts(draft, result.amounts));
    }
    setAllocation(null);
  }

  function removeSplit(index: number) {
    const next = removeExtraSplit(draft, index);
    const nextAmounts = amounts.filter((_, i) => i !== index);
    const delta = leftover(total, nextAmounts, dp);
    const absorbed = nextAmounts.length > 1 ? absorb(nextAmounts, delta, dp) : null;
    // Split 1 takes the removed amount, in the same write as the removal.
    patch(absorbed ? { ...next, ...withAmounts({ ...draft, ...next }, absorbed) } : next);
    setPage(Math.max(0, index - 1));
    if (nextAmounts.length > 1 && !absorbed)
      askLeftover(nextAmounts, total, dp, leftoverHandlers.ask);
  }

  /**
   * The keypad sheet closed with `typed` (null when nothing was typed): the one write of the
   * amount, then the leftover the change made — split 1 takes it, or the sliders ask.
   */
  function commitKeypad(typed: string | null) {
    const target = keypadFor;
    setKeypadFor(null);
    if (target === null) return;
    // The converted figure is its own field; it doesn't take part in the splits' leftover.
    if (target === 'foreign') {
      if (typed !== null)
        patch({ foreignAmount: typed, foreignCurrencyCode: accountCurrencyCode ?? undefined });
      return;
    }
    if (target === 'total') {
      const nextTotal = typed ?? total;
      if (typed !== null) patch({ total: typed });
      place(amounts, nextTotal);
      return;
    }
    const split = target === 0 ? null : extras[target - 1];
    if (target !== 0 && !split) return;
    const nextAmounts =
      typed === null ? amounts : amounts.map((a, i) => (i === target ? typed : a));
    if (typed !== null)
      patch(split ? patchExtraSplit(draft, target - 1, { amount: typed }) : { amount: typed });
    place(nextAmounts, total, target);
  }

  const detailValue: DetailRowsValue = {
    type: draft.type,
    categoryName: draft.categoryName ?? null,
    sourceAccountId: draft.sourceId ?? null,
    destinationAccountId: draft.destinationId ?? null,
    budgetId: draft.budgetId ?? null,
    dateLabel: new Date(draft.date).toLocaleString(appLocale(), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    notes: draft.notes ?? null,
    tags: draft.extraTags ?? [],
    sharedWith: draft.sharedWith ?? null,
  };

  const itemCount =
    row.kind === 'receipt' && draft.notes ? draft.notes.split('\n').filter(Boolean).length : 0;

  // The payee is a row of its own, except on a split page, which shows each split's payee itself.
  const detailRows = (withPayee: boolean) => (
    <DetailRows
      value={detailValue}
      onChange={handleDetailChange}
      onDatePress={openDatePicker}
      payee={withPayee ? { name: payeeName, onPress: () => setSheet('payee') } : undefined}
      statusRow={
        row.errorMessage && !readOnly
          ? {
              message: row.errorMessage,
              onRetry: () => {
                void retryError();
              },
            }
          : undefined
      }
      unsure={unsureRows}
      readOnly={readOnly}
      accounts={assetAccounts}
      currencies={currencies}
      sharedPeople={sharedPeople}
      tagsSuggestions={recentTags}
      categories={categories}
      budgets={budgets}
      loading={referenceLoading}
    />
  );

  function renderSplitPage(index: number) {
    const split = index === 0 ? null : extras[index - 1];
    return (
      <SplitPage
        amount={split ? split.amount : draft.amount}
        currency={currency}
        type={draft.type}
        description={split ? split.description : draft.description}
        payee={split ? split.payeeName : payeeName}
        isNewPayee={split ? split.isNewPayee : draft.isNewPayee}
        readOnly={readOnly}
        amountTone={index === 0 && unsure.includes('amount') ? 'warn' : 'default'}
        onAmountPress={() => setKeypadFor(index)}
        onDescriptionPress={() => setTextFor(index)}
        onPayeePress={() => (index === 0 ? setSheet('payee') : setExtraPayeeFor(index))}
        onRemove={index > 0 ? () => removeSplit(index) : undefined}
      >
        {split ? (
          <DetailRows
            value={{
              ...detailValue,
              categoryName: split.categoryName ?? null,
              budgetId: split.budgetId ?? null,
              notes: split.notes ?? null,
              tags: split.extraTags ?? [],
              sharedWith: split.sharedWith ?? null,
            }}
            onChange={(change) => handleExtraDetailChange(index, change)}
            onDatePress={openDatePicker}
            readOnly={readOnly}
            accounts={assetAccounts}
            currencies={currencies}
            sharedPeople={sharedPeople}
            tagsSuggestions={recentTags}
            categories={categories}
            budgets={budgets}
            loading={referenceLoading}
          />
        ) : (
          detailRows(false)
        )}
      </SplitPage>
    );
  }

  const keypadValue =
    keypadFor === 'total'
      ? total
      : keypadFor === 'foreign'
        ? (draft.foreignAmount ?? '0')
        : typeof keypadFor === 'number'
          ? (amounts[keypadFor] ?? '0')
          : draft.amount;

  // The text sheet edits one of three things; the value and its setter stay in step as one pair.
  const textField: { value: string; onChange: (value: string) => void } =
    textFor === 'title'
      ? {
          value: draft.groupTitle ?? draft.description,
          onChange: (groupTitle) => patch({ groupTitle }),
        }
      : textFor === 0
        ? { value: draft.description, onChange: (description) => patch({ description }) }
        : typeof textFor === 'number'
          ? {
              value: extras[textFor - 1]?.description ?? '',
              onChange: (description) =>
                patch(patchExtraSplit(draft, textFor - 1, { description })),
            }
          : { value: '', onChange: () => {} };

  return (
    <Screen bottom modal>
      <View style={{ flex: 1 }}>
        <ModalHeader
          title={tr('draft.title')}
          onClose={() => router.back()}
          right={
            <IconButton
              icon="ellipsis-horizontal"
              label={tr('capture.more')}
              onPress={() => setSheet('menu')}
            />
          }
        />

        {!readOnly && (
          <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.xs }}>
            <Segmented
              options={[
                { key: 'withdrawal', label: tr('capture.typeExpense') },
                { key: 'deposit', label: tr('capture.typeIncome') },
                { key: 'transfer', label: tr('capture.typeTransfer') },
              ]}
              value={draft.type}
              onChange={(key) => handleTypeChange(key as 'withdrawal' | 'deposit' | 'transfer')}
            />
          </View>
        )}

        {!splitMode && (
          <View
            style={{
              alignItems: 'center',
              paddingTop: t.space.sm,
              paddingBottom: t.space.md,
              paddingHorizontal: t.space.xl,
            }}
          >
            <Pressable onPress={() => setKeypadFor(0)} disabled={readOnly}>
              <Money
                amount={draft.amount}
                currency={currency}
                type={draft.type}
                size="title"
                loading={currenciesLoading}
                tone={unsure.includes('amount') ? 'warn' : 'default'}
              />
            </Pressable>
            {/* The title is what the transaction is called in Firefly III, as on the transaction
                screen; the payee is the first row of the details below. */}
            <Pressable
              onPress={() => setTextFor(0)}
              disabled={readOnly}
              accessibilityRole="button"
              accessibilityLabel={tr('fields.description')}
            >
              <Text
                style={[
                  t.type.heading,
                  {
                    color: draft.description ? t.color.text : t.color.textFaint,
                    marginTop: t.space.xs,
                    textAlign: 'center',
                  },
                ]}
                numberOfLines={2}
              >
                {draft.description || tr('fields.description')}
              </Text>
            </Pressable>
            {!!aliasCaption && (
              <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>
                {aliasCaption}
              </Text>
            )}
            {draft.isNewPayee && draft.type !== 'transfer' && (
              <View style={{ marginTop: t.space.sm }}>
                <Chip label={`⚑ ${tr('draft.newPayeeWillBeCreated')}`} tone="warn" />
              </View>
            )}
          </View>
        )}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: splitMode ? t.space.sm : 0,
            gap: t.space.md,
            paddingBottom: t.space.lg,
          }}
        >
          {/* A receipt the model couldn't read a currency from can't be confirmed without one. */}
          {!readOnly && !draft.currencyCode && (
            <View style={{ alignItems: 'center' }}>
              <Chip
                label={`${tr('draft.pickCurrency')} ▾`}
                tone="warn"
                onPress={() => setSheet('currency')}
              />
            </View>
          )}

          {showFx && (
            <Card flush style={{ marginHorizontal: t.space.lg }}>
              <ListRow
                first
                label={chargedLabel}
                value={
                  draft.foreignAmount
                    ? formatMoney(
                        draft.foreignAmount,
                        currencyOf(currencies, accountCurrencyCode ?? ''),
                      )
                    : '—'
                }
                tone={draft.foreignAmount ? 'default' : 'warn'}
                check={!draft.foreignAmount}
                chevron={!readOnly}
                onPress={readOnly ? undefined : () => setKeypadFor('foreign')}
              />
              {!draft.foreignAmount && !readOnly && (
                <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.sm }}>
                  <Text style={[t.type.label, { color: t.color.warn }]}>
                    {tr('capture.enterAccountPaid', {
                      currency: currencySymbol(accountCurrencyCode, currencies),
                    })}
                  </Text>
                </View>
              )}
              {!!draft.foreignAmount && !!impliedRate && impliedRate !== '0' && (
                <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.sm }}>
                  {/* prettier-ignore */}
                  <Text style={[t.type.caption, { color: t.color.textMuted }]}>{fxCaption(currencySymbol(accountCurrencyCode, currencies), currencySymbol(draft.currencyCode, currencies), impliedRate)}</Text>
                </View>
              )}
            </Card>
          )}

          {splitMode ? (
            <>
              <View
                style={{
                  alignItems: 'center',
                  gap: 2 /* eslint-disable-line no-restricted-syntax -- kit-exception: pre-Kit-V2 literal (MKL-81) */,
                  paddingHorizontal: t.space.xl,
                }}
              >
                <Text style={[t.type.caption, { color: t.color.textMuted }]}>
                  {tr('splits.total')}
                </Text>
                <Pressable onPress={() => setKeypadFor('total')} disabled={readOnly}>
                  <Money
                    amount={total}
                    currency={currency}
                    type={draft.type}
                    size="title"
                    loading={currenciesLoading}
                  />
                </Pressable>
                <Pressable
                  onPress={() => setTextFor('title')}
                  disabled={readOnly}
                  accessibilityRole="button"
                  accessibilityLabel={tr('splits.title')}
                >
                  <Text
                    style={[t.type.heading, { color: t.color.text, textAlign: 'center' }]}
                    numberOfLines={2}
                  >
                    {draft.groupTitle || draft.description}
                  </Text>
                </Pressable>
              </View>

              <View
                // eslint-disable-next-line no-restricted-syntax -- kit-exception: pre-Kit-V2 literal (MKL-81)
                style={{ flexDirection: 'row', gap: 6, paddingHorizontal: t.space.lg }}
                role="tablist"
                aria-label={tr('splits.partSelector', { defaultValue: 'Parts' })}
              >
                {amounts.map((amt, idx) => {
                  const isSelected = idx === pageIndex;
                  return (
                    <Pressable
                      key={idx}
                      onPress={() => setPage(idx)}
                      role="tab"
                      aria-selected={isSelected}
                      style={{
                        flex: 1,
                        height: 44,
                        // eslint-disable-next-line no-restricted-syntax -- kit-exception: pre-Kit-V2 literal (MKL-81)
                        borderRadius: 12,
                        borderWidth: isSelected ? 2 : 1,
                        borderColor: isSelected ? t.color.accent : t.color.border,
                        backgroundColor: isSelected ? t.color.accentSoft : t.color.surface,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text
                        style={{
                          // eslint-disable-next-line no-restricted-syntax -- kit-exception: pre-Kit-V2 literal (MKL-81)
                          fontSize: 12,
                          fontWeight: '600',
                          color: isSelected ? t.color.accent : t.color.textMuted,
                        }}
                      >
                        {tr('splits.partN', { number: idx + 1, defaultValue: `Part ${idx + 1}` })}
                      </Text>
                      <Text
                        style={{
                          // eslint-disable-next-line no-restricted-syntax -- kit-exception: pre-Kit-V2 literal (MKL-81)
                          fontSize: 13,
                          fontWeight: '500',
                          color: isSelected ? t.color.accent : t.color.text,
                          fontVariant: ['tabular-nums'],
                        }}
                      >
                        {amt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <SplitPager
                total={total}
                count={amounts.length}
                index={pageIndex}
                onIndexChange={setPage}
                currency={currency}
                type={draft.type}
                leftover={rest}
                readOnly={readOnly}
                onTotalPress={() => setKeypadFor('total')}
                onReassign={() => askLeftover(amounts, total, dp, leftoverHandlers.ask)}
                renderPage={renderSplitPage}
              />
            </>
          ) : (
            <>
              {detailRows(true)}
              {unsure.length > 0 && (
                <Text
                  style={[
                    t.type.caption,
                    {
                      color: t.color.textMuted,
                      paddingHorizontal: t.space.xl,
                      marginTop: -t.space.xs,
                    },
                  ]}
                >
                  {tr('draft.readerUnsureNote')}
                </Text>
              )}
            </>
          )}

          {row.kind !== 'receipt' && !row.receiptImagePath && row.state !== 'synced' && (
            <Card flush style={{ marginHorizontal: t.space.lg }}>
              <ListRow
                first
                leading={<Tile icon="camera" size={40} />}
                label={tr('capture.receiptPhoto')}
                subtitle={tr('capture.cameraOrLibrary')}
                chevron
                onPress={attachPhoto}
              />
            </Card>
          )}
          {(row.kind === 'receipt' || !!row.receiptImagePath) && (
            <>
              <SectionHeader title={tr('capture.receiptPhoto')} />
              <Card flush style={{ marginHorizontal: t.space.lg }}>
                <Pressable
                  onPress={() => setSheet('photo')}
                  accessibilityRole="button"
                  accessibilityLabel={tr('draft.showPhoto')}
                >
                  <ListRow
                    first
                    leading={
                      row.receiptImagePath ? (
                        <Image
                          source={{ uri: row.receiptImagePath }}
                          resizeMode="cover"
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: t.radius.sm,
                            backgroundColor: t.color.surfaceAlt,
                          }}
                        />
                      ) : (
                        <Tile icon="receipt-outline" size={40} />
                      )
                    }
                    label={
                      itemCount > 0
                        ? tr('draft.itemCount', { count: itemCount })
                        : tr('draft.receipt')
                    }
                    subtitle={
                      draft.readBy
                        ? tr('draft.readBy', {
                            provider: draft.readBy.provider,
                            model: draft.readBy.model,
                          })
                        : undefined
                    }
                    chevron
                  />
                </Pressable>
              </Card>
            </>
          )}

          {/* Where it was made (#67). The coordinates as they are: naming the place would need a
              geocoder, and Firefly III's own map is where this is worth looking at. */}
          {!!draft.location && (
            <Text
              style={[
                t.type.caption,
                { color: t.color.textFaint, paddingHorizontal: t.space.xl, marginTop: -t.space.xs },
              ]}
            >
              {tr('draft.near', {
                latitude: draft.location.latitude,
                longitude: draft.location.longitude,
              })}
            </Text>
          )}
        </ScrollView>

        {readOnly ? (
          <View style={{ alignItems: 'center', padding: t.space.lg, gap: t.space.md }}>
            <StatusPill
              state={row.state === 'synced' ? 'ok' : 'queued'}
              label={row.state === 'synced' ? tr('draft.synced') : tr('draft.queued')}
            />
            {!!pendingCreate && (
              <>
                <Button
                  title={tr('draft.cancelSending')}
                  variant="secondary"
                  onPress={cancelSending}
                />
                <Text style={[t.type.label, { color: t.color.textMuted, textAlign: 'center' }]}>
                  {tr('draft.cancelSendingHint')}
                </Text>
              </>
            )}
          </View>
        ) : (
          <StickyFooter>
            {splitMode ? (
              <View style={{ flexDirection: 'row', gap: t.space.sm, width: '100%' }}>
                <Button
                  title={tr('splits.addPart')}
                  variant="secondary"
                  onPress={() => setAllocation({ kind: 'newSplit' })}
                  disabled={confirming}
                  style={{ flex: 1 }}
                />
                <Button
                  title={confirming ? tr('draft.confirming') : tr('inbox.confirm')}
                  onPress={handleConfirm}
                  disabled={confirming || !readiness.ready}
                  hint={!readiness.ready ? missingLabel(readiness.missing) : undefined}
                  style={{ flex: 2 }}
                />
              </View>
            ) : (
              <Button
                title={confirming ? tr('draft.confirming') : tr('inbox.confirm')}
                onPress={handleConfirm}
                disabled={confirming || !readiness.ready}
                hint={!readiness.ready ? missingLabel(readiness.missing) : undefined}
                size="lg"
              />
            )}
          </StickyFooter>
        )}
      </View>

      <AmountSheet
        visible={keypadFor !== null}
        title={
          keypadFor === 'total'
            ? tr('splits.total')
            : keypadFor === 'foreign'
              ? chargedLabel
              : tr('fields.amount')
        }
        initial={keypadValue}
        currency={keypadFor === 'foreign' ? accountCurrency : currency}
        type={draft.type}
        loading={currenciesLoading}
        onDone={commitKeypad}
      />

      <Sheet
        visible={textFor !== null}
        onClose={() => setTextFor(null)}
        title={textFor === 'title' ? tr('splits.title') : tr('fields.description')}
        footer={<Button title={tr('common.done')} onPress={() => setTextFor(null)} />}
      >
        <TextField value={textField.value} onCommit={textField.onChange} autoFocus />
      </Sheet>

      <PayeeSheet
        visible={sheet === 'payee'}
        onClose={closeSheet}
        histories={histories}
        payeeLabel={draft.type === 'deposit' ? 'payer' : 'payee'}
        onSelect={(h) => {
          void choosePayee(draft, h.displayName, false);
        }}
        onCreateNew={(text) => {
          void choosePayee(draft, text, true);
        }}
      />

      <PayeeSheet
        visible={extraPayeeFor !== null}
        onClose={() => setExtraPayeeFor(null)}
        histories={histories}
        payeeLabel={draft.type === 'deposit' ? 'payer' : 'payee'}
        onSelect={(h) => {
          if (extraPayeeFor !== null)
            patch(
              patchExtraSplit(draft, extraPayeeFor - 1, {
                payeeName: h.displayName,
                payeeId: undefined,
                isNewPayee: false,
              }),
            );
        }}
        onCreateNew={(text) => {
          if (extraPayeeFor !== null)
            patch(
              patchExtraSplit(draft, extraPayeeFor - 1, {
                payeeName: text,
                payeeId: undefined,
                isNewPayee: true,
              }),
            );
        }}
      />

      {!!allocation && (
        <AllocationSheet
          mode={allocation}
          amounts={amounts}
          labels={amounts.map((_, i) => {
            const category = i === 0 ? draft.categoryName : extras[i - 1]?.categoryName;
            return (
              tr('splits.position', { index: i + 1, count: amounts.length }) +
              (category ? ` · ${category}` : '')
            );
          })}
          currency={currency}
          type={draft.type}
          onDone={onAllocated}
          onClose={() => setAllocation(null)}
        />
      )}

      <Sheet visible={sheet === 'menu'} onClose={closeSheet} title={tr('draft.menuTitle')}>
        <View style={{ gap: t.space.lg, paddingBottom: t.space.lg }}>
          <Card flush>
            {readOnly && !!row.ff3GroupId &&
              // prettier-ignore
              <ListRow first label={tr('draft.openInActivity')} chevron onPress={() => { closeSheet(); navigateOnce(`/transactions/${row.ff3GroupId}`); }} />}
            {!readOnly &&
              // prettier-ignore
              <ListRow first label={tr('splits.splitIntoParts')} chevron onPress={() => { closeSheet(); setAllocation({ kind: 'newSplit' }); }} />}
            {!readOnly && (
              <ListRow
                first={readOnly && !row.ff3GroupId}
                label={tr('fields.currency')}
                value={draft.currencyCode || '—'}
                chevron
                onPress={() => setSheet('currency')}
              />
            )}
            {!readOnly && !!row.receiptImagePath && (
              <ListRow
                label={tr('draft.replacePhoto')}
                chevron
                onPress={() => {
                  closeSheet();
                  void attachPhoto();
                }}
              />
            )}
          </Card>
          <Card flush>
            {/* prettier-ignore */}
            <ListRow first label={tr('draft.deleteDraft')} tone="danger" onPress={handleDeleteDraft} />
          </Card>
        </View>
      </Sheet>
      <PickerSheet
        visible={sheet === 'currency'}
        onClose={closeSheet}
        title={tr('fields.currency')}
        options={pickableCurrencies(currencies, draft.currencyCode).map((c) => ({
          key: c.code,
          label: c.code,
        }))}
        selected={draft.currencyCode}
        onSelect={(code) => code && patch({ currencyCode: code })}
      />
      <Snackbar entry={snackbar} onDismiss={dismissSnackbar} />
      <PhotoViewer
        uri={sheet === 'photo' ? row.receiptImagePath : null}
        onClose={closeSheet}
        onDelete={readOnly ? undefined : removePhoto}
      />
    </Screen>
  );
}
