// Draft review (design §6.3) — one legible card for both a manual draft and a receipt. A split
// entry (Split, or a duplicated split transaction) shows its tracked total and one page per split.
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { pickDateTime } from '../../src/ui/pickDate';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Chip, IconButton, ModalHeader, Screen, Segmented } from '../../src/ui/kit';
import { currencyOf } from '../../src/money/format';
import { haptics } from '../../src/ui/haptics';
import { askPhotoSource, pickPhoto } from '../../src/receipt/pickPhoto';
import { attachReceiptImage } from '../../src/inbox/updateDraft';
import { draftReadiness } from '../../src/inbox/readiness';
import { draftAccountCurrency, needsForeignAmount } from '../../src/inbox/fx';
import { unsureFields } from '../../src/inbox/unsure';
import { useMerchantHistories } from '../../src/lookup/useMerchantHistories';
import { confirmDestructive } from '../../src/ui/confirm';
import type { SnackbarEntry } from '../../src/ui/Snackbar';
import type { Draft } from '../../src/inbox/draft';
import { readDraft } from '../../src/inbox/draftJson';
import type { InboxItemRow } from '../../src/inbox/useInboxSections';
import { useAction } from '../../src/ui/useAction';
import { draftAmounts, draftTotal, isSplitDraft } from '../../src/inbox/draftSplits';
import { leftover } from '../../src/splits/allocate';
import { askLeftover } from '../../src/splits/placeLeftover';
import { divideDecimal } from '../../src/api/ff3/decimal';
import { useShake } from '../../src/ui/feedback';
import { useDraftItem, usePendingCreate } from '../../src/inbox/useDraftItem';
import { useDraftEditor } from '../../src/inbox/useDraftEditor';
import { useSplitDraft } from '../../src/ui/draft/useSplitDraft';
import { useDraftReferenceData } from '../../src/ui/draft/useDraftReferenceData';
import { DraftHero, DraftSplitHero } from '../../src/ui/draft/DraftHero';
import { DraftFxRow } from '../../src/ui/draft/DraftFxRow';
import { DraftPartTabs } from '../../src/ui/draft/DraftPartTabs';
import { DraftReceiptSection } from '../../src/ui/draft/DraftReceiptSection';
import { DraftSplitPager } from '../../src/ui/draft/DraftSplitPager';
import { DraftFooter } from '../../src/ui/draft/DraftFooter';
import { DraftSheets } from '../../src/ui/draft/DraftSheets';
import { draftToDetailValue } from '../../src/ui/draft/draftDetailValue';
import { DraftDetailRows } from '../../src/ui/draft/DraftDetailRows';
import type { UnsureRow } from '../../src/ui/DetailRows';

export default function DraftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t: tr } = useTranslation();
  const row = useDraftItem(id);

  if (!row) {
    return (
      <Screen bottom modal>
        <ModalHeader title={tr('draft.title')} onClose={() => router.back()} />
      </Screen>
    );
  }
  return <DraftEditor row={row} />;
}

export function DraftEditor({ row }: { row: InboxItemRow }) {
  const id = row.id;
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const { shake } = useShake();

  const refData = useDraftReferenceData();
  const pendingCreate = usePendingCreate(id);

  const attachPhoto = act(tr('capture.receiptPhoto'), async () => {
    const source = await askPhotoSource();
    if (!source) return;
    const photo = await pickPhoto(source);
    if (!photo) return;
    await attachReceiptImage(db, id, photo.uri);
  });

  const draft: Draft = readDraft(row.draftJson);
  const histories = useMerchantHistories(draft.type === 'transfer' ? undefined : draft.type);

  const [sheet, setSheet] = useState<'payee' | 'menu' | 'photo' | 'currency' | null>(null);
  const closeSheet = () => setSheet(null);
  const [snackbar, setSnackbar] = useState<SnackbarEntry | null>(null);
  const dismissSnackbar = useCallback(() => setSnackbar(null), []);

  const readOnly = row.state === 'confirmed' || row.state === 'synced';
  const payeeName = draft.type === 'deposit' ? draft.sourceName : draft.destinationName;
  const aliasCaption =
    draft.payeeReadAs && draft.payeeReadAs !== payeeName
      ? tr('draft.viaAlias', { alias: draft.payeeReadAs })
      : null;

  const currency = currencyOf(refData.currencies, draft.currencyCode);
  const dp = currency.decimalPlaces;
  const accountCurrencyCode = draftAccountCurrency(draft, (accId) =>
    accId ? refData.assetAccounts.find((a) => a.id === accId)?.currencyCode : undefined,
  );
  const showFx = needsForeignAmount(accountCurrencyCode, draft.currencyCode);
  const impliedRate =
    draft.foreignAmount && draft.foreignAmount !== '0' && draftTotal(draft) !== '0'
      ? divideDecimal(draftTotal(draft), draft.foreignAmount, 2)
      : null;
  const accountCurrency = currencyOf(refData.currencies, accountCurrencyCode ?? '');
  const readiness = draftReadiness(draft, accountCurrencyCode);
  const unsure = readOnly ? [] : unsureFields(draft);
  const unsureRows = new Set<UnsureRow>(
    unsure.filter((f): f is 'payee' | 'date' => f !== 'amount'),
  );
  const splitMode = isSplitDraft(draft);
  const extras = draft.extraSplits ?? [];
  const amounts = draftAmounts(draft);
  const total = draftTotal(draft);
  const rest = splitMode ? leftover(total, amounts, dp) : 0n;
  const chargedLabel = tr(splitMode ? 'draft.accountChargedTotal' : 'draft.accountCharged');

  const {
    patch,
    choosePayee,
    handleDetailChange,
    handleExtraDetailChange,
    handleTypeChange,
    handleConfirm,
    retryError,
    handleDeleteDraft,
    removePhoto,
    cancelSending,
  } = useDraftEditor({
    db,
    id,
    draft,
    assetAccounts: refData.assetAccounts,
    payeeName,
    readinessReady: readiness.ready,
    pendingCreateId: pendingCreate?.id ?? null,
    act,
    shake,
    onTick: () => haptics.tick(),
    onWarn: () => haptics.warn(),
    onCloseSheet: closeSheet,
    onBack: () => router.back(),
    confirmDestructive,
    setSnackbar,
  });

  const {
    page,
    setPage,
    allocation,
    setAllocation,
    keypadFor,
    setKeypadFor,
    textFor,
    setTextFor,
    textField,
    extraPayeeFor,
    setExtraPayeeFor,
    onAllocated,
    removeSplit,
    commitKeypad,
    leftoverHandlers,
    startSplit,
    selectExtraPayee,
  } = useSplitDraft({ draft, dp, accountCurrencyCode, patch });

  const pageIndex = Math.min(page, extras.length);
  const confirming = act.pending(tr('inbox.confirm'));

  const fxAccount = refData.assetAccounts.find(
    (a) => a.id === (draft.type === 'deposit' ? draft.destinationId : draft.sourceId),
  );

  function openDatePicker() {
    pickDateTime(new Date(draft.date), (picked) => patch({ date: picked.toISOString() }));
  }

  const detailValue = draftToDetailValue(draft);
  const itemCount =
    row.kind === 'receipt' && draft.notes ? draft.notes.split('\n').filter(Boolean).length : 0;

  const renderDetailRows = (withPayee: boolean) => (
    <DraftDetailRows
      value={detailValue}
      onChange={handleDetailChange}
      onDatePress={openDatePicker}
      payee={withPayee ? { name: payeeName, onPress: () => setSheet('payee') } : undefined}
      errorMessage={row.errorMessage}
      onRetryError={retryError}
      unsureRows={unsureRows}
      readOnly={readOnly}
      referenceData={refData}
    />
  );

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
          <DraftHero
            amount={draft.amount}
            currency={currency}
            type={draft.type}
            description={draft.description}
            currenciesLoading={refData.currenciesLoading}
            amountTone={unsure.includes('amount') ? 'warn' : 'default'}
            aliasCaption={aliasCaption}
            isNewPayee={draft.isNewPayee}
            readOnly={readOnly}
            onAmountPress={() => setKeypadFor(0)}
            onDescriptionPress={() => setTextFor(0)}
          />
        )}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: splitMode ? t.space.sm : 0,
            gap: t.space.md,
            paddingBottom: t.space.lg,
          }}
        >
          {!readOnly && !draft.currencyCode && (
            <View style={{ alignItems: 'center' }}>
              <Chip
                label={`${tr('draft.pickCurrency')} ▾`}
                tone="warn"
                onPress={() => setSheet('currency')}
              />
            </View>
          )}

          <DraftFxRow
            showFx={showFx}
            readOnly={readOnly}
            isSplit={splitMode}
            accountName={fxAccount?.name}
            accountCurrencyCode={accountCurrencyCode}
            entryCurrencyCode={draft.currencyCode}
            foreignAmount={draft.foreignAmount}
            impliedRate={impliedRate}
            currencies={refData.currencies}
            onPress={() => setKeypadFor('foreign')}
          />

          {splitMode ? (
            <>
              <DraftSplitHero
                total={total}
                currency={currency}
                type={draft.type}
                title={draft.groupTitle || draft.description}
                currenciesLoading={refData.currenciesLoading}
                readOnly={readOnly}
                onTotalPress={() => setKeypadFor('total')}
                onTitlePress={() => setTextFor('title')}
              />

              <DraftPartTabs amounts={amounts} pageIndex={pageIndex} onSelectPage={setPage} />

              <DraftSplitPager
                total={total}
                amounts={amounts}
                pageIndex={pageIndex}
                onSelectPage={setPage}
                currency={currency}
                draft={draft}
                extras={extras}
                leftover={rest}
                readOnly={readOnly}
                unsure={unsure}
                payeeName={payeeName}
                detailValue={detailValue}
                referenceData={refData}
                onTotalPress={() => setKeypadFor('total')}
                onReassign={() => askLeftover(amounts, total, dp, leftoverHandlers.ask)}
                onAmountPress={(index) => setKeypadFor(index)}
                onDescriptionPress={(index) => setTextFor(index)}
                onPayeePress={(index) =>
                  index === 0 ? setSheet('payee') : setExtraPayeeFor(index)
                }
                onRemoveSplit={removeSplit}
                onExtraDetailChange={handleExtraDetailChange}
                onDatePress={openDatePicker}
                renderMainDetailRows={() => renderDetailRows(false)}
              />
            </>
          ) : (
            <>
              {renderDetailRows(true)}
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

          <DraftReceiptSection
            rowKind={row.kind}
            receiptImagePath={row.receiptImagePath}
            rowState={row.state}
            itemCount={itemCount}
            readBy={draft.readBy}
            onAttachPhoto={attachPhoto}
            onShowPhoto={() => setSheet('photo')}
          />

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

        <DraftFooter
          readOnly={readOnly}
          rowState={row.state}
          hasPendingCreate={!!pendingCreate}
          onCancelSending={cancelSending}
          isSplit={splitMode}
          confirming={confirming}
          readiness={readiness}
          fxAccountName={fxAccount?.name}
          onAddPart={startSplit}
          onConfirm={handleConfirm}
        />
      </View>

      <DraftSheets
        sheet={sheet}
        onCloseSheet={closeSheet}
        onOpenSheet={setSheet}
        readOnly={readOnly}
        rowFf3GroupId={row.ff3GroupId}
        receiptImagePath={row.receiptImagePath}
        draft={draft}
        amounts={amounts}
        total={total}
        currency={currency}
        accountCurrency={accountCurrency}
        currencies={refData.currencies}
        currenciesLoading={refData.currenciesLoading}
        chargedLabel={chargedLabel}
        histories={histories}
        keypadFor={keypadFor}
        onCommitKeypad={commitKeypad}
        textFor={textFor}
        onCloseText={() => setTextFor(null)}
        textField={textField}
        extraPayeeFor={extraPayeeFor}
        onCloseExtraPayee={() => setExtraPayeeFor(null)}
        onSelectExtraPayee={selectExtraPayee}
        allocation={allocation}
        onCloseAllocation={() => setAllocation(null)}
        onAllocated={onAllocated}
        onStartSplit={startSplit}
        onSelectCurrency={(code) => patch({ currencyCode: code })}
        onAttachPhoto={() => void attachPhoto()}
        onDeleteDraft={() => void handleDeleteDraft()}
        onRemovePhoto={() => void removePhoto()}
        onChoosePayee={(d, name, isNew) => {
          void choosePayee(d, name, isNew);
        }}
        snackbar={snackbar}
        onDismissSnackbar={dismissSnackbar}
      />
    </Screen>
  );
}
