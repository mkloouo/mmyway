// Draft review (design §6.3) — one legible card for both a manual draft and a receipt. A split
// entry (Split, or a duplicated split transaction) shows its tracked total and one page per split.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Alert, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useShake } from '../../src/ui/feedback';
import { useLocalSearchParams, router } from 'expo-router';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { pickDateTime } from '../../src/ui/pickDate';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, BarIconButton, Card, Chip, Button, Money, StatusPill, Sheet, Row } from '../../src/ui/components';
import { DetailRows, type DetailRowsValue } from '../../src/ui/DetailRows';
import { PayeeSheet } from '../../src/ui/PayeeSheet';
import { Keypad } from '../../src/ui/Keypad';
import { TextField } from '../../src/ui/TextField';
import { SplitPager } from '../../src/ui/SplitPager';
import { AllocationSheet, type AllocationMode, type AllocationResult } from '../../src/ui/AllocationSheet';
import { currencyOf } from '../../src/ui/money';
import { haptics } from '../../src/ui/haptics';
import { inboxItems, outboxOperations, referenceCategories, referenceBudgets, referenceCurrencies } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import { confirmInboxItem, undoConfirm } from '../../src/inbox/createManualEntry';
import { askPhotoSource, pickPhoto } from '../../src/receipt/pickPhoto';
import { updateDraft, deleteInboxItem, attachReceiptImage } from '../../src/inbox/updateDraft';
import { draftReadiness } from '../../src/inbox/readiness';
import { applyDigit, type KeypadKey } from '../../src/capture/amountInput';
import { buildMerchantLookup, type MerchantHistory } from '../../src/lookup/merchantLookup';
import { matchAlias, rememberPayeeAlias, removeAlias, upsertAlias, PAYEE } from '../../src/lookup/aliases';
import { Snackbar, type SnackbarEntry } from '../../src/ui/Snackbar';
import { generateId } from '../../src/utils/id';
import type { Draft, DraftSplit } from '../../src/inbox/draft';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { missingLabel } from '../../src/ui/readinessLabel';
import { appLocale } from '../../src/i18n';
import { readDraft } from '../../src/inbox/draftJson';
import { useAction } from '../../src/ui/useAction';
import { addSplit, draftAmounts, draftTotal, isSplitDraft, patchExtraSplit, removeExtraSplit, withAmounts } from '../../src/inbox/draftSplits';
import { absorb, leftover } from '../../src/splits/allocate';

export default function DraftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const { shake, shakeStyle } = useShake(); // the visual twin of the warn haptic

  const { data: rows } = useLiveQuery(db.select().from(inboxItems).where(eq(inboxItems.id, id)));
  const assetAccounts = useAssetAccounts() ?? [];
  const { data: categories } = useLiveQuery(db.select().from(referenceCategories));
  const { data: budgets } = useLiveQuery(db.select().from(referenceBudgets));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));

  const row = rows?.[0];
  // A confirmed entry whose create is still waiting in the queue can be taken back — the same
  // rule as Undo: only while it is `pending`, never once sending started.
  const { data: ops } = useLiveQuery(db.select().from(outboxOperations).where(eq(outboxOperations.inboxItemId, id)), [id]);
  const pendingCreate = (ops ?? []).find((op) => op.kind === 'create_transaction' && op.status === 'pending') ?? null;
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
    // A receipt goes back to `parsed`: as `captured` the next sync would re-read the photo
    // and overwrite the reviewed draft.
    const outcome = await undoConfirm(db, id, { outboxOperationId: pendingCreate.id, previousState: row?.kind === 'receipt' ? 'parsed' : 'captured' });
    if (outcome === 'already_sent') Alert.alert(tr('inbox.alreadySent'), tr('draft.alreadySentBody'));
  });
  const draft: Draft | null = row ? readDraft(row.draftJson) : null;

  const [histories, setHistories] = useState<MerchantHistory[]>([]);
  useEffect(() => {
    const lookupType = draft?.type === 'transfer' ? undefined : draft?.type;
    buildMerchantLookup(db, { type: lookupType }).then((map) => setHistories([...map.values()]));
  }, [db, draft?.type]);

  const [amountSheetOpen, setAmountSheetOpen] = useState(false);
  const [payeeSheetOpen, setPayeeSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [snackbar, setSnackbar] = useState<SnackbarEntry | null>(null);
  const dismissSnackbar = useCallback(() => setSnackbar(null), []);
  // Split editing (page 0 is the draft's own fields, 1..N its extraSplits).
  const [page, setPage] = useState(0);
  const [allocation, setAllocation] = useState<AllocationMode | null>(null);
  const [keypadFor, setKeypadFor] = useState<number | 'total' | null>(null);
  const [textFor, setTextFor] = useState<number | 'title' | null>(null);
  const [extraPayeeFor, setExtraPayeeFor] = useState<number | null>(null);

  const readOnly = row ? row.state === 'confirmed' || row.state === 'synced' : false;
  const payeeName = draft ? (draft.type === 'deposit' ? draft.sourceName : draft.destinationName) : undefined;
  const aliasCaption = draft?.payeeReadAs && draft.payeeReadAs !== payeeName ? tr('draft.viaAlias', { alias: draft.payeeReadAs }) : null;

  if (!row || !draft) {
    return (
      <Screen bottom>
        <AppBar title={tr('draft.title')} left={<CloseButton />} />
      </Screen>
    );
  }

  const currency = currencyOf(currencies ?? [], draft.currencyCode);
  const dp = currency.decimalPlaces;
  const readiness = draftReadiness(draft);
  const splitMode = isSplitDraft(draft);
  const extras = draft.extraSplits ?? [];
  const amounts = draftAmounts(draft);
  const total = draftTotal(draft);
  const rest = splitMode ? leftover(total, amounts, dp) : 0n;
  const pageIndex = Math.min(page, extras.length);

  function patch(fields: Partial<Draft>) {
    updateDraft(db, id, fields);
  }

  // Replacing a payee name that didn't come from FF3 (what a receipt read, a name typed as new,
  // or an alias's earlier guess) teaches an alias, so that text books to this payee next time.
  const choosePayee = act(tr('capture.payee'), async (d: Draft, name: string, isNew: boolean) => {
    const raw = d.payeeReadAs ?? (d.isNewPayee ? payeeName : undefined);
    const previous = raw ? await matchAlias(db, PAYEE, raw) : null;
    const learned = raw ? await rememberPayeeAlias(db, raw, name) : false;
    patch(d.type === 'deposit'
      ? { sourceName: name, sourceId: undefined, isNewPayee: isNew, payeeReadAs: learned ? raw : undefined }
      : { destinationName: name, destinationId: undefined, isNewPayee: isNew, payeeReadAs: learned ? raw : undefined });
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
    if ('destinationAccountId' in change) draftPatch.destinationId = change.destinationAccountId ?? undefined;
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
    if ('destinationAccountId' in change) shared.destinationId = change.destinationAccountId ?? undefined;
    patch({ ...shared, ...(Object.keys(own).length ? patchExtraSplit(draft!, index - 1, own) : {}) });
  }

  function openDatePicker() {
    pickDateTime(new Date(draft!.date), (picked) => patch({ date: picked.toISOString() }));
  }

  const handleConfirm = act(tr('inbox.confirm'), async () => {
    if (confirming || !readiness.ready) {
      if (!readiness.ready) { haptics.warn(); shake(); }
      return;
    }
    setConfirming(true);
    try {
      await confirmInboxItem(db, id);
      haptics.tick();
      router.back();
    } finally {
      setConfirming(false);
    }
  });

  function handleDeleteDraft() {
    setMenuOpen(false);
    Alert.alert(tr('draft.deleteTitle'), tr('draft.deleteBody'), [
      { text: tr('common.cancel'), style: 'cancel' },
      { text: tr('common.delete'), style: 'destructive', onPress: async () => { await deleteInboxItem(db, id); router.back(); } },
    ]);
  }

  /**
   * When the splits don't add up to the total, split 1 takes the difference (split 2, if split 1
   * was just typed); only when it can't are the sliders asked.
   */
  function placeLeftover(nextAmounts: string[], nextTotal: string, exclude?: number) {
    const delta = leftover(nextTotal, nextAmounts, dp);
    if (delta === 0n || nextAmounts.length < 2) return;
    const absorbed = absorb(nextAmounts, delta, dp, exclude);
    if (absorbed) patch(withAmounts(draft!, absorbed));
    else setAllocation({ kind: 'leftover', delta, exclude });
  }

  /** The Reassign button: the sliders, whatever split 1 could take. */
  function askLeftover(nextAmounts: string[], nextTotal: string) {
    const delta = leftover(nextTotal, nextAmounts, dp);
    if (delta !== 0n && nextAmounts.length > 1) setAllocation({ kind: 'leftover', delta });
  }

  function onAllocated(result: AllocationResult) {
    if (!allocation) return;
    if (allocation.kind === 'newSplit' && result.newAmount) {
      patch(addSplit(draft!, result.amounts, result.newAmount));
      setPage(extras.length + 1);
    } else {
      patch(withAmounts(draft!, result.amounts));
    }
    setAllocation(null);
  }

  function removeSplit(index: number) {
    const next = removeExtraSplit(draft!, index);
    const nextAmounts = amounts.filter((_, i) => i !== index);
    const delta = leftover(total, nextAmounts, dp);
    const absorbed = nextAmounts.length > 1 ? absorb(nextAmounts, delta, dp) : null;
    // Split 1 takes the removed amount, in the same write as the removal.
    patch(absorbed ? { ...next, ...withAmounts({ ...draft!, ...next }, absorbed) } : next);
    setPage(Math.max(0, index - 1));
    if (nextAmounts.length > 1 && !absorbed) askLeftover(nextAmounts, total);
  }

  function closeKeypad() {
    const target = keypadFor;
    setKeypadFor(null);
    if (target === 'total') placeLeftover(amounts, total);
    else if (typeof target === 'number') placeLeftover(amounts, total, target);
  }

  function typeDigit(key: KeypadKey) {
    if (keypadFor === 'total') patch({ total: applyDigit(total, key, dp) });
    else if (keypadFor === 0) patch({ amount: applyDigit(draft!.amount, key, dp) });
    else if (typeof keypadFor === 'number') {
      const split = extras[keypadFor - 1];
      if (split) patch(patchExtraSplit(draft!, keypadFor - 1, { amount: applyDigit(split.amount, key, dp) }));
    }
  }

  const detailValue: DetailRowsValue = {
    type: draft.type,
    categoryName: draft.categoryName ?? null,
    sourceAccountId: draft.sourceId ?? null,
    destinationAccountId: draft.destinationId ?? null,
    budgetId: draft.budgetId ?? null,
    dateLabel: new Date(draft.date).toLocaleString(appLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    notes: draft.notes ?? null,
    sharedWith: draft.sharedWith ?? null,
  };

  const itemCount = row.kind === 'receipt' && draft.notes ? draft.notes.split('\n').filter(Boolean).length : 0;

  const detailRows = (
    <DetailRows
      value={detailValue}
      onChange={handleDetailChange}
      onDatePress={openDatePicker}
      readOnly={readOnly}
      accounts={assetAccounts}
      currencies={currencies ?? []}
      categories={categories ?? []}
      budgets={budgets ?? []}
    />
  );

  function renderSplitPage(index: number) {
    const split = index === 0 ? null : extras[index - 1];
    const amount = split ? split.amount : draft!.amount;
    const description = split ? split.description : draft!.description;
    const payee = split ? split.payeeName : payeeName;
    const isNew = split ? split.isNewPayee : draft!.isNewPayee;
    return (
      <>
        <View style={{ alignItems: 'center', paddingHorizontal: t.space.xl, gap: t.space.xs }}>
          <Pressable onPress={() => setKeypadFor(index)} disabled={readOnly} accessibilityRole="button" accessibilityLabel={tr('fields.amount')}>
            <Money amount={amount} currency={currency} type={draft!.type} size="heading" />
          </Pressable>
          <Pressable onPress={() => setTextFor(index)} disabled={readOnly} accessibilityRole="button" accessibilityLabel={tr('fields.description')}>
            <Text style={[t.type.body, { color: t.color.text, textAlign: 'center' }]} numberOfLines={2}>{description || '—'}</Text>
          </Pressable>
          {draft!.type !== 'transfer' && (
            <Pressable
              onPress={() => (index === 0 ? setPayeeSheetOpen(true) : setExtraPayeeFor(index))}
              disabled={readOnly}
              accessibilityRole="button"
              accessibilityLabel={draft!.type === 'deposit' ? tr('capture.payer') : tr('capture.payee')}
            >
              <Text style={[t.type.label, { color: t.color.accent }]}>{payee || '—'}</Text>
            </Pressable>
          )}
          {isNew && draft!.type !== 'transfer' && <Chip label={`⚑ ${tr('draft.newPayeeWillBeCreated')}`} tone="warn" />}
        </View>
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
            currencies={currencies ?? []}
            categories={categories ?? []}
            budgets={budgets ?? []}
          />
        ) : detailRows}
        {index > 0 && !readOnly && (
          <View style={{ paddingHorizontal: t.space.lg }}>
            <Button title={tr('splits.remove')} variant="danger" onPress={() => removeSplit(index)} />
          </View>
        )}
      </>
    );
  }

  const keypadValue = keypadFor === 'total' ? total : typeof keypadFor === 'number' ? (amounts[keypadFor] ?? '0') : draft.amount;

  return (
    <Screen bottom>
      <View style={{ flex: 1 }}>
        <AppBar
          title={tr('draft.title')}
          left={<CloseButton />}
          right={(
            <BarIconButton icon="ellipsis-horizontal" label={tr('capture.more')} onPress={() => setMenuOpen(true)} />
          )}
        />

        {!splitMode && (
          <View style={{ alignItems: 'center', paddingVertical: t.space.lg }}>
            <Pressable onPress={() => !readOnly && setAmountSheetOpen(true)} disabled={readOnly}>
              <Money amount={draft.amount} currency={currency} type={draft.type} size="title" />
            </Pressable>
            {draft.type !== 'transfer' && (
              <Pressable onPress={() => !readOnly && setPayeeSheetOpen(true)} disabled={readOnly}>
                <Text style={[t.type.heading, { color: t.color.text, marginTop: t.space.xs }]}>{payeeName || '—'}</Text>
              </Pressable>
            )}
            {!!aliasCaption && (
              <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>{aliasCaption}</Text>
            )}
            {draft.isNewPayee && draft.type !== 'transfer' && (
              <View style={{ marginTop: t.space.sm }}>
                <Chip label={`⚑ ${tr('draft.newPayeeWillBeCreated')}`} tone="warn" />
              </View>
            )}
          </View>
        )}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: t.space.md, paddingBottom: t.space.lg }}>
          {!!row.errorMessage && !readOnly && (
            <View style={{ marginHorizontal: t.space.lg, padding: t.space.md, borderRadius: t.radius.sm, backgroundColor: t.color.warnSoft }}>
              <Text style={[t.type.label, { color: t.color.warn }]}>{row.errorMessage}</Text>
            </View>
          )}
          {splitMode ? (
            <>
              <Pressable onPress={() => setTextFor('title')} disabled={readOnly} style={{ paddingHorizontal: t.space.xl, paddingTop: t.space.md }} accessibilityRole="button" accessibilityLabel={tr('splits.title')}>
                <Text style={[t.type.heading, { color: t.color.text, textAlign: 'center' }]} numberOfLines={2}>{draft.groupTitle || draft.description}</Text>
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
                onReassign={() => askLeftover(amounts, total)}
                renderPage={renderSplitPage}
              />
            </>
          ) : detailRows}

          {row.kind !== 'receipt' && !row.receiptImagePath && row.state !== 'synced' && (
            <Card style={{ marginHorizontal: t.space.lg }}>
              <Row first label={tr('capture.receiptPhoto')} value={tr('capture.attach')} chevron onPress={attachPhoto} />
            </Card>
          )}
          {(row.kind === 'receipt' || !!row.receiptImagePath) && (
            <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
              {row.receiptImagePath ? (
                <Pressable onPress={() => setPhotoOpen(true)} accessibilityRole="imagebutton" accessibilityLabel={tr('draft.showPhoto')}>
                  <Image source={{ uri: row.receiptImagePath }} resizeMode="cover" style={{ width: '100%', height: 140, borderRadius: t.radius.sm, backgroundColor: t.color.surfaceAlt }} />
                </Pressable>
              ) : (
                <Text style={[t.type.label, { color: t.color.textFaint }]}>{tr('draft.photoInFf3')}</Text>
              )}
              <Text style={[t.type.body, { color: t.color.textMuted }]}>
                {itemCount > 0 ? tr('draft.itemCount', { count: itemCount }) : tr('draft.receipt')}
              </Text>
            </Card>
          )}
        </ScrollView>

        {readOnly ? (
          <View style={{ alignItems: 'center', padding: t.space.lg, gap: t.space.md }}>
            <StatusPill state={row.state === 'synced' ? 'ok' : 'queued'} label={row.state === 'synced' ? tr('draft.synced') : tr('draft.queued')} />
            {!!pendingCreate && (
              <Button title={tr('draft.cancelSending')} variant="secondary" onPress={cancelSending} />
            )}
          </View>
        ) : (
          <View style={{ padding: t.space.lg, gap: t.space.sm }}>
            {readiness.missing.length > 0 && (
              <Animated.Text style={[t.type.label, { color: t.color.warn, textAlign: 'center' }, shakeStyle]}>{missingLabel(readiness.missing)}</Animated.Text>
            )}
            <View style={{ flexDirection: 'row', gap: t.space.sm }}>
              <Button title={confirming ? tr('draft.confirming') : tr('inbox.confirm')} onPress={handleConfirm} disabled={confirming || !readiness.ready} size="lg" style={{ flex: 1 }} />
              <Button title={tr('splits.split')} variant="secondary" onPress={() => setAllocation({ kind: 'newSplit' })} disabled={confirming} size="lg" />
            </View>
          </View>
        )}
      </View>

      <Sheet visible={amountSheetOpen} onClose={() => setAmountSheetOpen(false)} title={tr('fields.amount')}>
        <Money amount={draft.amount} currency={currency} type={draft.type} size="display" />
        <Keypad
          compact
          onDigit={(key: KeypadKey) => patch({ amount: applyDigit(draft.amount, key, dp) })}
          saveLabel={tr('common.done')}
          onSave={() => setAmountSheetOpen(false)}
        />
      </Sheet>

      <Sheet visible={keypadFor !== null} onClose={closeKeypad} title={keypadFor === 'total' ? tr('splits.total') : tr('fields.amount')}>
        <Money amount={keypadValue} currency={currency} type={draft.type} size="display" />
        <Keypad compact onDigit={typeDigit} saveLabel={tr('common.done')} onSave={closeKeypad} />
      </Sheet>

      <Sheet
        visible={textFor !== null}
        onClose={() => setTextFor(null)}
        title={textFor === 'title' ? tr('splits.title') : tr('fields.description')}
        footer={<Button title={tr('common.done')} onPress={() => setTextFor(null)} />}
      >
        <TextField
          value={textFor === 'title' ? (draft.groupTitle ?? draft.description) : textFor === 0 ? draft.description : typeof textFor === 'number' ? (extras[textFor - 1]?.description ?? '') : ''}
          onChangeText={(value) => {
            if (textFor === 'title') patch({ groupTitle: value });
            else if (textFor === 0) patch({ description: value });
            else if (typeof textFor === 'number') patch(patchExtraSplit(draft, textFor - 1, { description: value }));
          }}
          autoFocus
        />
      </Sheet>

      <PayeeSheet
        visible={payeeSheetOpen}
        onClose={() => setPayeeSheetOpen(false)}
        histories={histories}
        payeeLabel={draft.type === 'deposit' ? 'payer' : 'payee'}
        onSelect={(h) => { void choosePayee(draft, h.displayName, false); }}
        onCreateNew={(text) => { void choosePayee(draft, text, true); }}
      />

      <PayeeSheet
        visible={extraPayeeFor !== null}
        onClose={() => setExtraPayeeFor(null)}
        histories={histories}
        payeeLabel={draft.type === 'deposit' ? 'payer' : 'payee'}
        onSelect={(h) => { if (extraPayeeFor !== null) patch(patchExtraSplit(draft, extraPayeeFor - 1, { payeeName: h.displayName, payeeId: undefined, isNewPayee: false })); }}
        onCreateNew={(text) => { if (extraPayeeFor !== null) patch(patchExtraSplit(draft, extraPayeeFor - 1, { payeeName: text, payeeId: undefined, isNewPayee: true })); }}
      />

      {!!allocation && (
        <AllocationSheet
          visible
          mode={allocation}
          amounts={amounts}
          labels={amounts.map((_, i) => {
            const category = i === 0 ? draft.categoryName : extras[i - 1]?.categoryName;
            return tr('splits.position', { index: i + 1, count: amounts.length }) + (category ? ` · ${category}` : '');
          })}
          currency={currency}
          type={draft.type}
          onDone={onAllocated}
          onClose={() => setAllocation(null)}
        />
      )}

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={tr('draft.menuTitle')}>
        {readOnly && !!row.ff3GroupId && (
          <Row
            first
            label={tr('draft.openInActivity')}
            icon="open-outline"
            onPress={() => { setMenuOpen(false); navigateOnce(`/transactions/${row.ff3GroupId}`); }}
          />
        )}
        <Row first={!readOnly || !row.ff3GroupId} label={tr('draft.deleteDraft')} icon="trash-outline" tone="danger" onPress={handleDeleteDraft} />
      </Sheet>
      <Snackbar entry={snackbar} onDismiss={dismissSnackbar} />
      <Modal visible={photoOpen && !!row.receiptImagePath} transparent animationType="fade" onRequestClose={() => setPhotoOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: t.color.photoBackdrop, justifyContent: 'center' }} onPress={() => setPhotoOpen(false)} accessibilityLabel={tr('draft.closePhoto')}>
          {!!row.receiptImagePath && <Image source={{ uri: row.receiptImagePath }} resizeMode="contain" style={{ width: '100%', height: '100%' }} />}
        </Pressable>
      </Modal>
    </Screen>
  );
}

function CloseButton() {
  const { t: tr } = useTranslation();
  return <BarIconButton icon="close" label={tr('common.close')} onPress={() => router.back()} />;
}
