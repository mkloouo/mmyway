// Capture (design §6.2) — amount first, one screen. The form scrolls above a pinned keypad only
// when the window is too short for both (a pop-up or split-screen window, landscape, a big font).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { appLocale } from '../src/i18n';
import { useFlyAway, useShake } from '../src/ui/feedback';
import { useConfirmDiscard } from '../src/ui/useConfirmDiscard';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
import { Button, IconButton, Screen, Segmented, Toast } from '../src/ui/kit';
import { Keypad } from '../src/ui/Keypad';
import { currencyOf, currencySymbol } from '../src/money/format';
import { haptics } from '../src/ui/haptics';
import { askPhotoSource, pickPhoto } from '../src/receipt/pickPhoto';
import { isDirtyAmount, type KeypadKey } from '../src/capture/amountInput';
import { useCaptureForm, type CaptureForm } from '../src/capture/useCaptureForm';
import { useCaptureScreen } from '../src/capture/useCaptureScreen';
import { useFxState } from '../src/capture/useFxState';
import { useCaptureSave } from '../src/capture/useCaptureSave';
import { captureKeyHeight } from '../src/capture/keyHeight';
import { useToast } from '../src/ui/useToast';
import { Snackbar } from '../src/ui/Snackbar';
import { blockedConfirmHint } from '../src/ui/readinessLabel';
import { useAction } from '../src/ui/useAction';
import { TX_TYPES } from '../src/transactions/txTypes';
import { CaptureFxCard } from '../src/ui/capture/CaptureFxCard';
import { CaptureAmountHero } from '../src/ui/capture/CaptureAmountHero';
import { CaptureFormCard } from '../src/ui/capture/CaptureFormCard';
import { CaptureSheets, type CaptureSheetType } from '../src/ui/capture/CaptureSheets';

const SHORT_WINDOW = 600;

export default function CaptureScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const { shake } = useShake();
  const { fly, ghost, ghostStyle, fieldStyle } = useFlyAway();
  const window = useWindowDimensions();
  const short = window.height < SHORT_WINDOW;
  const amountType = short ? t.type.title : t.type.display;

  const {
    type,
    amount,
    currencyCode,
    date,
    dateMode,
    merchantRawInput,
    forceNewPayee,
    sourceId,
    destinationId,
    categoryName,
    budgetId,
    description,
    notes,
    tags,
    sharedWith,
    foreignAmount,
    photoUri,
    set,
    pressKey,
    markSaved,
  } = useCaptureForm();

  const isDirty = isDirtyAmount(amount);

  const {
    assetAccounts,
    categories,
    sharedPeople,
    recentTags,
    budgets,
    currencies,
    histories,
    recentAccounts,
    effectiveCurrencyCode,
    effectiveSourceId,
    aliasCaption,
    rankedPayees,
    sourceAccount,
    destinationAccount,
    budget,
    envelopeLeft,
    allEnvelopes,
    envelopesOn,
    applyPayeeHistory,
  } = useCaptureScreen({
    db,
    type,
    amount,
    currencyCode,
    sourceId,
    destinationId,
    merchantRawInput,
    forceNewPayee,
    budgetId,
    isDirty,
    set,
  });

  const [toast, setToast] = useToast();
  const [sheet, setSheet] = useState<CaptureSheetType>(null);
  const accountSheetTarget =
    sheet === 'accountSource' ? 'source' : sheet === 'accountDestination' ? 'destination' : null;

  const {
    accountCurrencyCode,
    showFx,
    fxAccount,
    foreignAmountInvalid,
    parsedForeignAmount,
    fxMissing,
    impliedRate,
  } = useFxState({
    type,
    effectiveCurrencyCode,
    sourceAccount,
    destinationAccount,
    amount,
    foreignAmount,
    isDirty,
  });

  const keyHeight = Math.min(showFx ? 44 : 48, captureKeyHeight(window));
  const currency = currencyOf(currencies, effectiveCurrencyCode ?? '');

  const saving = act.pending(tr('common.save'));
  const { readiness, blocks, handleSave, snackbar, dismissSnackbar } = useCaptureSave({
    db,
    assetAccounts,
    currency,
    effectiveCurrencyCode: effectiveCurrencyCode ?? '',
    effectiveSourceId,
    sourceAccount,
    destinationAccount,
    type,
    amount,
    date,
    dateMode,
    description,
    merchantRawInput,
    forceNewPayee,
    destinationId,
    categoryName,
    budgetId,
    notes,
    tags,
    sharedWith,
    photoUri,
    showFx,
    accountCurrencyCode,
    parsedForeignAmount,
    foreignAmountInvalid,
    fxMissing,
    isDirty,
    act,
    isSaving: saving,
    shake,
    fly,
    onTick: haptics.tick,
    onWarn: haptics.warn,
    setToast,
    markSaved,
  });

  const attachPhoto = act(tr('capture.receiptPhoto'), async () => {
    const source = await askPhotoSource();
    if (!source) return;
    const photo = await pickPhoto(source);
    if (photo) set({ photoUri: photo.uri });
  });

  const confirmClose = useConfirmDiscard(isDirty, 'capture.discardTitle');

  const dateText =
    dateMode === 'today'
      ? tr('capture.today')
      : dateMode === 'yesterday'
        ? tr('capture.yesterday')
        : date.toLocaleString(appLocale(), {
            day: 'numeric',
            month: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });

  const moreHasValue = !!(notes || tags.length > 0 || sharedWith || photoUri);
  const isPayeeType = type === 'withdrawal' || type === 'deposit';
  const fxAccountName = fxAccount?.name ?? accountCurrencyCode;

  const blockedHint = !readiness.ready
    ? blockedConfirmHint(
        readiness.missing.filter((m) => m !== 'amount').length > 0
          ? readiness.missing.filter((m) => m !== 'amount')
          : readiness.missing,
      )
    : fxMissing
      ? tr('capture.enterAccountPaid', {
          currency: currencySymbol(accountCurrencyCode, currencies),
        })
      : foreignAmountInvalid
        ? tr('common.invalidAmount')
        : undefined;

  return (
    <Screen bottom modal>
      <View style={{ flex: 1 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space.sm,
            paddingHorizontal: t.space.lg,
            paddingTop: t.space.sm,
          }}
        >
          <IconButton
            icon="close"
            label={tr('common.close')}
            onPress={confirmClose}
            color={t.color.text}
          />
          <View style={{ flex: 1 }}>
            <Segmented
              options={TX_TYPES.map((option) => ({ key: option.type, label: tr(option.labelKey) }))}
              value={type}
              onChange={(next) => set({ type: next })}
            />
          </View>
        </View>

        <CaptureAmountHero
          short={short}
          amountType={amountType}
          amount={amount}
          currency={currency}
          fieldStyle={fieldStyle}
          ghost={ghost}
          ghostStyle={ghostStyle}
          effectiveCurrencyCode={effectiveCurrencyCode}
          dateText={dateText}
          moreHasValue={moreHasValue}
          aliasCaption={aliasCaption}
          onOpenCurrency={() => setSheet('currency')}
          onOpenDate={() => setSheet('date')}
          onOpenDetails={() => setSheet('more')}
        />

        <ScrollView
          style={{ flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={{ paddingBottom: t.space.sm }}
          keyboardShouldPersistTaps="handled"
        >
          <CaptureFxCard
            showFx={showFx}
            fxMissing={fxMissing}
            fxAccountName={fxAccountName}
            foreignAmount={foreignAmount}
            onChangeForeignAmount={(foreignAmount) => set({ foreignAmount })}
            accountCurrencyCode={accountCurrencyCode}
            effectiveCurrencyCode={effectiveCurrencyCode}
            currencies={currencies}
            impliedRate={impliedRate}
          />

          <CaptureFormCard
            type={type}
            description={description}
            onChangeDescription={(description) => set({ description })}
            isPayeeType={isPayeeType}
            merchantRawInput={merchantRawInput}
            rankedPayees={rankedPayees}
            onOpenPayeeSheet={() => setSheet('payee')}
            onApplyPayeeHistory={applyPayeeHistory}
            blocks={blocks}
            recentAccounts={recentAccounts}
            effectiveSourceId={effectiveSourceId}
            destinationId={destinationId}
            onOpenSourceAccountSheet={() => setSheet('accountSource')}
            onOpenDestinationAccountSheet={() => setSheet('accountDestination')}
            onSelectSourceAccount={(id) => {
              const acct = assetAccounts.find((a) => a.id === id);
              const patch: Partial<CaptureForm> = { sourceId: id };
              if (!isDirty && acct?.currencyCode) {
                patch.currencyCode = acct.currencyCode;
              }
              set(patch);
            }}
            onSelectDestinationAccount={(id) => set({ destinationId: id })}
            categoryName={categoryName}
            budget={budget}
            envelopesOn={envelopesOn}
            envelopeLeft={envelopeLeft}
            currency={currency}
            onOpenCategorySheet={() => setSheet('category')}
            onOpenBudgetSheet={() => setSheet('budget')}
          />
        </ScrollView>

        <View style={{ flex: 1 }} />

        <Keypad
          style={{ paddingHorizontal: t.space.md }}
          keyHeight={keyHeight}
          onDigit={(key: KeypadKey) => pressKey(key, currency.decimalPlaces)}
        />
        <View
          style={{
            flexDirection: 'row',
            paddingHorizontal: t.space.md,
            paddingTop: t.space.xs,
            paddingBottom: t.space.lg,
          }}
        >
          <View style={{ flex: 1, marginHorizontal: t.space.xs }}>
            <Button
              title={tr('capture.toInbox')}
              variant="secondary"
              size="lg"
              textStyle={t.type.body}
              disabled={saving || foreignAmountInvalid || fxMissing}
              onPress={() => handleSave(false)}
            />
          </View>
          <View style={{ flex: 2, marginHorizontal: t.space.xs }}>
            <Button
              title={tr('capture.saveAndConfirm')}
              icon="checkmark-circle"
              size="lg"
              disabled={!readiness.ready || foreignAmountInvalid || fxMissing || saving}
              hint={blockedHint}
              onPress={() => handleSave(true)}
            />
          </View>
        </View>

        <Toast message={toast} />
        <Snackbar entry={snackbar} onDismiss={dismissSnackbar} bottom={t.space.lg} />
      </View>

      <CaptureSheets
        sheet={sheet}
        onClose={() => setSheet(null)}
        date={date}
        dateMode={dateMode}
        onDateChange={set}
        currencies={currencies}
        effectiveCurrencyCode={effectiveCurrencyCode ?? ''}
        onSelectCurrency={(code) => set({ currencyCode: code })}
        categories={categories}
        categoryName={categoryName}
        onSelectCategory={(categoryName) => set({ categoryName })}
        budgets={budgets}
        budgetId={budgetId}
        envelopesOn={envelopesOn}
        allEnvelopes={allEnvelopes}
        currency={currency}
        onSelectBudget={(budgetId) => set({ budgetId })}
        histories={histories}
        payeeType={type === 'deposit' ? 'deposit' : 'withdrawal'}
        onSelectPayeeHistory={applyPayeeHistory}
        onCreateNewPayee={(text) => set({ merchantRawInput: text, forceNewPayee: true })}
        accountSheetTarget={accountSheetTarget}
        assetAccounts={assetAccounts}
        isTransfer={type === 'transfer'}
        effectiveSourceId={effectiveSourceId}
        onSelectAccount={(target, a) => {
          const patch: Partial<CaptureForm> =
            target === 'source' ? { sourceId: a.id } : { destinationId: a.id };
          if (!isDirty && a.currencyCode && (type !== 'transfer' || target === 'source')) {
            patch.currencyCode = a.currencyCode;
          }
          set(patch);
        }}
        notes={notes}
        tags={tags}
        sharedWith={sharedWith}
        photoUri={photoUri}
        recentTags={recentTags}
        sharedPeople={sharedPeople}
        onCommitDetails={set}
        onAttachPhoto={attachPhoto}
        onRemovePhoto={() => set({ photoUri: null })}
      />
    </Screen>
  );
}
