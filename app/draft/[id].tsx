// Draft review (design §6.3) — one legible card for both a manual draft and a receipt. A split
// entry (Split, or a duplicated split transaction) shows its tracked total and one page per split.
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useShake } from '../../src/ui/feedback';
import { useLocalSearchParams, router } from 'expo-router';
import { eq } from 'drizzle-orm';
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
  Chip,
  Button,
  Money,
  StatusPill,
  Sheet,
  Row,
  Banner,
  CloseButton,
} from '../../src/ui/components';
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
import { currencyOf } from '../../src/ui/money';
import { pickableCurrencies } from '../../src/ui/currencies';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { haptics } from '../../src/ui/haptics';
import { inboxItems, outboxOperations } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import { confirmInboxItem } from '../../src/inbox/createManualEntry';
import { discardOperation } from '../../src/sync/outbox';
import { getClient } from '../../src/api/ff3/session';
import { alertDiscardOutcome } from '../../src/inbox/discardAlert';
import { askPhotoSource, pickPhoto } from '../../src/receipt/pickPhoto';
import { updateDraft, deleteInboxItem, attachReceiptImage } from '../../src/inbox/updateDraft';
import { draftReadiness } from '../../src/inbox/readiness';
import { useMerchantHistories } from '../../src/lookup/useMerchantHistories';
import { confirmDestructive } from '../../src/ui/confirm';
import { reportErrors } from '../../src/ui/reportError';
import {
  matchAlias,
  rememberPayeeAlias,
  removeAlias,
  upsertAlias,
  PAYEE,
} from '../../src/lookup/aliases';
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
      <Screen bottom>
        <AppBar title={tr('draft.title')} left={<CloseButton onPress={() => router.back()} />} />
      </Screen>
    );
  }
  // Mounted once the row is known, so the editor below never has to re-narrow it.
  return <DraftEditor row={row} />;
}

function DraftEditor({ row }: { row: InboxItemRow }) {
  const id = row.id;
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const { shake, shakeStyle } = useShake(); // the visual twin of the warn haptic

  const accountRows = useAssetAccounts();
  const assetAccounts = accountRows ?? [];
  const categories = useCategories();
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
  const [keypadFor, setKeypadFor] = useState<number | 'total' | null>(null);
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
  const readiness = draftReadiness(draft);
  const splitMode = isSplitDraft(draft);
  const extras = draft.extraSplits ?? [];
  const amounts = draftAmounts(draft);
  const total = draftTotal(draft);
  const rest = splitMode ? leftover(total, amounts, dp) : 0n;
  const pageIndex = Math.min(page, extras.length);

  // Not awaited, but never silent: a failed write is logged and shown instead of becoming an
  // unhandled rejection.
  function patch(fields: Partial<Draft>) {
    void reportErrors(
      tr('common.save'),
      () => updateDraft(db, id, fields),
      (message) => setSnackbar({ id: generateId(), message }),
    );
  }

  // Replacing a payee name that didn't come from FF3 (what a receipt read, a name typed as new,
  // or an alias's earlier guess) teaches an alias, so that text books to this payee next time.
  const choosePayee = act(tr('capture.payee'), async (d: Draft, name: string, isNew: boolean) => {
    const raw = d.payeeReadAs ?? (d.isNewPayee ? payeeName : undefined);
    const previous = raw ? await matchAlias(db, PAYEE, raw) : null;
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
        if (previous?.matched) void upsertAlias(db, previous.alias);
        else void removeAlias(db, PAYEE, raw);
      },
    });
  });

  function handleDetailChange(change: Partial<DetailRowsValue>) {
    const draftPatch: Partial<Draft> = {};
    if ('categoryName' in change) draftPatch.categoryName = change.categoryName ?? undefined;
    if ('sourceAccountId' in change) draftPatch.sourceId = change.sourceAccountId ?? undefined;
    if ('destinationAccountId' in change)
      draftPatch.destinationId = change.destinationAccountId ?? undefined;
    if ('budgetId' in change) draftPatch.budgetId = change.budgetId ?? undefined;
    if ('notes' in change) draftPatch.notes = change.notes ?? undefined;
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
    sharedWith: draft.sharedWith ?? null,
  };

  const itemCount =
    row.kind === 'receipt' && draft.notes ? draft.notes.split('\n').filter(Boolean).length : 0;

  const detailRows = (
    <DetailRows
      value={detailValue}
      onChange={handleDetailChange}
      onDatePress={openDatePicker}
      readOnly={readOnly}
      accounts={assetAccounts}
      currencies={currencies}
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
              sharedWith: split.sharedWith ?? null,
            }}
            onChange={(change) => handleExtraDetailChange(index, change)}
            onDatePress={openDatePicker}
            readOnly={readOnly}
            accounts={assetAccounts}
            currencies={currencies}
            categories={categories}
            budgets={budgets}
            loading={referenceLoading}
          />
        ) : (
          detailRows
        )}
      </SplitPage>
    );
  }

  const keypadValue =
    keypadFor === 'total'
      ? total
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
    <Screen bottom>
      <View style={{ flex: 1 }}>
        <AppBar
          title={tr('draft.title')}
          left={<CloseButton onPress={() => router.back()} />}
          right={
            <BarIconButton
              icon="ellipsis-horizontal"
              label={tr('capture.more')}
              onPress={() => setSheet('menu')}
            />
          }
        />

        {!splitMode && (
          <View style={{ alignItems: 'center', paddingVertical: t.space.lg }}>
            <Pressable onPress={() => setKeypadFor(0)} disabled={readOnly}>
              <Money
                amount={draft.amount}
                currency={currency}
                type={draft.type}
                size="title"
                loading={currenciesLoading}
              />
            </Pressable>
            {draft.type !== 'transfer' && (
              <Pressable onPress={() => setSheet('payee')} disabled={readOnly}>
                <Text style={[t.type.heading, { color: t.color.text, marginTop: t.space.xs }]}>
                  {payeeName || '—'}
                </Text>
              </Pressable>
            )}
            {/* The title is always here, as on Capture, even when it is the payee's name: it is
                what the transaction is called in Firefly III. A transfer has no payee, so it
                is the heading. */}
            <Pressable
              onPress={() => setTextFor(0)}
              disabled={readOnly}
              accessibilityRole="button"
              accessibilityLabel={tr('fields.description')}
            >
              <Text
                style={[
                  draft.type === 'transfer' ? t.type.heading : t.type.body,
                  {
                    color: !draft.description
                      ? t.color.textFaint
                      : draft.type === 'transfer'
                        ? t.color.text
                        : t.color.textMuted,
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
          contentContainerStyle={{ gap: t.space.md, paddingBottom: t.space.lg }}
        >
          {!!row.errorMessage && !readOnly && <Banner inset>{row.errorMessage}</Banner>}
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
          {splitMode ? (
            <>
              <Pressable
                onPress={() => setTextFor('title')}
                disabled={readOnly}
                style={{ paddingHorizontal: t.space.xl, paddingTop: t.space.md }}
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
            detailRows
          )}

          {row.kind !== 'receipt' && !row.receiptImagePath && row.state !== 'synced' && (
            <Card style={{ marginHorizontal: t.space.lg }}>
              <Row
                first
                label={tr('capture.receiptPhoto')}
                value={tr('capture.attach')}
                chevron
                onPress={attachPhoto}
              />
            </Card>
          )}
          {(row.kind === 'receipt' || !!row.receiptImagePath) && (
            <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
              {row.receiptImagePath ? (
                <Pressable
                  onPress={() => setSheet('photo')}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={tr('draft.showPhoto')}
                >
                  <Image
                    source={{ uri: row.receiptImagePath }}
                    resizeMode="cover"
                    style={{
                      width: '100%',
                      height: 140,
                      borderRadius: t.radius.sm,
                      backgroundColor: t.color.surfaceAlt,
                    }}
                  />
                </Pressable>
              ) : (
                <Text style={[t.type.label, { color: t.color.textFaint }]}>
                  {tr('draft.photoInFf3')}
                </Text>
              )}
              <Text style={[t.type.body, { color: t.color.textMuted }]}>
                {itemCount > 0 ? tr('draft.itemCount', { count: itemCount }) : tr('draft.receipt')}
              </Text>
            </Card>
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
          <View style={{ padding: t.space.lg, gap: t.space.sm }}>
            {readiness.missing.length > 0 && (
              <Animated.Text
                style={[t.type.label, { color: t.color.warn, textAlign: 'center' }, shakeStyle]}
              >
                {missingLabel(readiness.missing)}
              </Animated.Text>
            )}
            <View style={{ flexDirection: 'row', gap: t.space.sm }}>
              <Button
                title={confirming ? tr('draft.confirming') : tr('inbox.confirm')}
                onPress={handleConfirm}
                disabled={confirming || !readiness.ready}
                size="lg"
                style={{ flex: 1 }}
              />
              <Button
                title={tr('splits.split')}
                variant="secondary"
                onPress={() => setAllocation({ kind: 'newSplit' })}
                disabled={confirming}
                size="lg"
              />
            </View>
          </View>
        )}
      </View>

      <AmountSheet
        visible={keypadFor !== null}
        title={keypadFor === 'total' ? tr('splits.total') : tr('fields.amount')}
        initial={keypadValue}
        currency={currency}
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
        {readOnly && !!row.ff3GroupId && (
          <Row
            first
            label={tr('draft.openInActivity')}
            icon="open-outline"
            onPress={() => {
              closeSheet();
              navigateOnce(`/transactions/${row.ff3GroupId}`);
            }}
          />
        )}
        {!readOnly && (
          <Row
            first={!row.ff3GroupId}
            label={tr('fields.currency')}
            value={draft.currencyCode || '—'}
            chevron
            onPress={() => setSheet('currency')}
          />
        )}
        <Row
          first={readOnly && !row.ff3GroupId}
          label={tr('draft.deleteDraft')}
          icon="trash-outline"
          tone="danger"
          onPress={handleDeleteDraft}
        />
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
      <PhotoViewer uri={sheet === 'photo' ? row.receiptImagePath : null} onClose={closeSheet} />
    </Screen>
  );
}
