// Capture (design §6.2) — amount first, one screen, no scrolling for the common case.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { appLocale } from '../src/i18n';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import { useFlyAway, useShake } from '../src/ui/feedback';
import { pickDateTime } from '../src/ui/pickDate';
import { useConfirmDiscard } from '../src/ui/useConfirmDiscard';
import { useBudgets, useCategories, useCurrencies } from '../src/db/useReferenceData';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
import { Screen, Chip, Button, Sheet, Toast, Row, CloseButton } from '../src/ui/components';
import { Keypad } from '../src/ui/Keypad';
import { PayeeSheet } from '../src/ui/PayeeSheet';
import { AccountPickerSheet, type AccountPickerAccount } from '../src/ui/AccountPickerSheet';
import { currencyOf, formatAmountInput } from '../src/ui/money';
import { categoryColor } from '../src/ui/categoryColor';
import { haptics } from '../src/ui/haptics';

import { askPhotoSource, pickPhoto } from '../src/receipt/pickPhoto';
import { useAssetAccounts } from '../src/accounts/useAssetAccounts';
import type { KeypadKey } from '../src/capture/amountInput';
import { buildEntryDate, yesterday } from '../src/capture/entryDate';
import { buildManualEntryInput, type CaptureFormState } from '../src/capture/buildManualEntryInput';
import { useCaptureDefaults } from '../src/capture/useCaptureDefaults';
import { useCaptureForm } from '../src/capture/useCaptureForm';
import { attachReceiptImage } from '../src/inbox/updateDraft';
import { createManualEntry, confirmInboxItem, undoConfirm } from '../src/inbox/createManualEntry';
import { draftReadiness } from '../src/inbox/readiness';
import {
  accountLastUsed,
  buildMerchantLookup,
  peekAccountLastUsed,
  peekMerchantLookup,
  type MerchantHistory,
} from '../src/lookup/merchantLookup';
import { matchAlias, PAYEE } from '../src/lookup/aliases';
import { rankCandidates } from '../src/suggest/rank';
import { divideDecimal, isNegative, parseDecimalInput } from '../src/api/ff3/decimal';
import { useToast } from '../src/ui/useToast';
import { Snackbar, type SnackbarEntry } from '../src/ui/Snackbar';
import type { Draft } from '../src/inbox/draft';
import { needsLabel } from '../src/ui/readinessLabel';
import { TextField } from '../src/ui/TextField';
import { PickerSheet } from '../src/ui/PickerSheet';
import { useAction } from '../src/ui/useAction';
import { logLine } from '../src/utils/log';
import { errorMessage } from '../src/utils/errorMessage';
import { pickableCurrencies, primaryCurrencyCode } from '../src/ui/currencies';
import { TX_TYPES } from '../src/transactions/txTypes';

// A ScrollView defaults to flexGrow/flexShrink 1, so a row of chips would otherwise stretch or
// be clipped as it competes with the keypad below it for height.
const rowScroll = { flexGrow: 0, flexShrink: 0 } as const;

function isDirtyAmount(amount: string): boolean {
  return !/^0*[.,]?0*$/.test(amount);
}

function labelKeyForType(t: Draft['type']): string {
  return TX_TYPES.find((x) => x.type === t)!.labelKey;
}

// The chip row shows a handful of choices, not a wall — the rest live behind the 🔍 chip's
// AccountPickerSheet. A selection outside that handful still needs to be visible, so it's pinned
// first rather than left unrepresented in the row.
function topChips<T extends AccountPickerAccount>(
  accounts: T[],
  selectedId: string | null | undefined,
  limit = 5,
): T[] {
  const top = accounts.slice(0, limit);
  if (selectedId && !top.some((a) => a.id === selectedId)) {
    const selected = accounts.find((a) => a.id === selectedId);
    if (selected) return [selected, ...top.slice(0, limit - 1)];
  }
  return top;
}

/**
 * A labelled row of account chips with the 🔍 chip that opens the full picker. Capture draws this
 * three times — from, to, and the single account of a non-transfer.
 */
function AccountChipRow({
  label,
  searchLabel,
  accounts,
  selectedId,
  onSearch,
  onSelect,
}: {
  label: string;
  searchLabel: string;
  accounts: AccountPickerAccount[];
  selectedId: string | null | undefined;
  onSearch: () => void;
  onSelect: (id: string) => void;
}) {
  const t = useTheme();
  return (
    <View>
      <Text style={[t.type.label, { color: t.color.textFaint, paddingHorizontal: t.space.lg }]}>
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={rowScroll}
        contentContainerStyle={{
          paddingHorizontal: t.space.lg,
          gap: t.space.sm,
          paddingTop: t.space.xs,
        }}
      >
        <Chip label="🔍" accessibilityLabel={searchLabel} onPress={onSearch} />
        {topChips(accounts, selectedId).map((a) => (
          <Chip
            key={a.id}
            label={a.name}
            selected={selectedId === a.id}
            onPress={() => onSelect(a.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export default function CaptureScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  // Visual twins of the haptics below (src/ui/feedback.ts): a refused Save & ✓ shakes what's
  // missing; a save floats the saved amount away while the cleared field fades in.
  const { shake, shakeStyle } = useShake();
  const { fly, ghost, ghostStyle, fieldStyle } = useFlyAway();
  const { defaultAccountId, defaultCurrencyCode } = useCaptureDefaults();

  const assetAccountRows = useAssetAccounts();
  const assetAccounts = useMemo(() => assetAccountRows ?? [], [assetAccountRows]);
  const categories = useCategories();
  const budgets = useBudgets();
  const currencies = useCurrencies();

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
    sharedWith,
    foreignAmount,
    photoUri,
    set,
    pressKey,
    markSaved,
  } = useCaptureForm();
  const attachPhoto = act(tr('capture.receiptPhoto'), async () => {
    const source = await askPhotoSource();
    if (!source) return;
    const photo = await pickPhoto(source);
    if (photo) set({ photoUri: photo.uri });
  });
  const [toast, setToast] = useToast();
  const [snackbar, setSnackbar] = useState<SnackbarEntry | null>(null);
  const dismissSnackbar = useCallback(() => setSnackbar(null), []);

  // Only one sheet is ever open, so it is one state rather than a boolean each.
  const [sheet, setSheet] = useState<
    | 'payee'
    | 'accountSource'
    | 'accountDestination'
    | 'currency'
    | 'category'
    | 'budget'
    | 'more'
    | 'date'
    | null
  >(null);
  const accountSheetTarget =
    sheet === 'accountSource' ? 'source' : sheet === 'accountDestination' ? 'destination' : null;

  // Seeded from the lookup warmed at startup (DbProvider, runSync) so the first frame already has
  // suggestions; the effect then refreshes it in case the cache moved since.
  const lookupType = type === 'transfer' ? undefined : type;
  const [loaded, setLoaded] = useState<{
    type: string | undefined;
    list: MerchantHistory[];
  } | null>(null);
  const histories = useMemo(
    () =>
      loaded && loaded.type === lookupType ? loaded.list : (peekMerchantLookup(lookupType) ?? []),
    [loaded, lookupType],
  );
  const [accountRecency, setAccountRecency] = useState<Map<string, string>>(
    () => peekAccountLastUsed() ?? new Map(),
  );
  useEffect(() => {
    let cancelled = false;
    buildMerchantLookup(db, { type: lookupType })
      .then((map) => {
        if (!cancelled) setLoaded({ type: lookupType, list: [...map.values()] });
      })
      .catch((err) => logLine('warn', `merchant lookup failed: ${errorMessage(err)}`));
    accountLastUsed(db)
      .then((m) => {
        if (!cancelled) setAccountRecency(m);
      })
      .catch((err) => logLine('warn', `account recency failed: ${errorMessage(err)}`));
    return () => {
      cancelled = true;
    };
  }, [db, lookupType]);
  // The chip rows lead with the accounts used most recently; FF3's order breaks ties and places
  // accounts never used (sort is stable).
  const recentAccounts = useMemo(
    () =>
      [...assetAccounts].sort((a, b) =>
        (accountRecency.get(b.name) ?? '').localeCompare(accountRecency.get(a.name) ?? ''),
      ),
    [assetAccounts, accountRecency],
  );

  // Defaults arrive asynchronously (SecureStore/app_settings) after first render — derived here
  // rather than mirrored into state via an effect, so there is nothing to keep in sync.
  const isPayeeType = type === 'withdrawal' || type === 'deposit';
  // One test for "something typed": "0," is still nothing, for the FX guard and the discard prompt alike.
  const isDirty = isDirtyAmount(amount);
  // Settings → Default currency, else FF3's primary currency — never nothing at all.
  const effectiveCurrencyCode =
    currencyCode ?? defaultCurrencyCode ?? primaryCurrencyCode(currencies);
  const effectiveSourceId =
    sourceId ?? (type === 'withdrawal' || type === 'transfer' ? defaultAccountId : null);

  const [matchedFor, setMatchedFor] = useState<{ text: string; caption: string | null } | null>(
    null,
  );
  useEffect(() => {
    if (!isPayeeType || !merchantRawInput.trim()) return;
    let cancelled = false;
    matchAlias(db, PAYEE, merchantRawInput)
      .then((match) => {
        if (cancelled) return;
        const caption =
          match.matched && match.alias.targetName !== merchantRawInput
            ? i18n.t('capture.booksViaAlias', { name: match.alias.targetName })
            : null;
        setMatchedFor({ text: merchantRawInput, caption });
      })
      .catch((err) => logLine('warn', `alias match failed: ${errorMessage(err)}`));
    return () => {
      cancelled = true;
    };
  }, [db, isPayeeType, merchantRawInput]);
  // A payee created explicitly as new skips alias matching (createManualEntry), so no caption then.
  const aliasCaption =
    isPayeeType && !forceNewPayee && matchedFor?.text === merchantRawInput
      ? matchedFor.caption
      : null;

  const rankedPayees = useMemo(
    () =>
      rankCandidates(histories, {})
        .slice(0, 6)
        .map((c) => histories.find((h) => h.merchantKey === c.merchantKey))
        .filter((h): h is MerchantHistory => !!h),
    [histories],
  );

  const sourceAccount = assetAccounts.find((a) => a.id === effectiveSourceId);
  const destinationAccount = assetAccounts.find((a) => a.id === destinationId);
  const budget = budgets.find((b) => b.id === budgetId);

  // FX (design §6.2): reveal when the account leg's currency differs from the chosen currency.
  const accountCurrencyCode =
    type === 'deposit' ? destinationAccount?.currencyCode : sourceAccount?.currencyCode;
  const showFx =
    !!accountCurrencyCode &&
    !!effectiveCurrencyCode &&
    accountCurrencyCode !== effectiveCurrencyCode;
  // parseDecimalInput accepts a comma or a bare trailing separator as the user is still typing —
  // divideDecimal doesn't, and a raw "12,50" used to crash the screen.
  const foreignAmountResult =
    showFx && foreignAmount.trim() ? parseDecimalInput(foreignAmount) : null;
  const foreignAmountInvalid = !!foreignAmountResult && !foreignAmountResult.ok;
  const parsedForeignAmount = foreignAmountResult?.ok ? foreignAmountResult.value : '';
  // The account's currency differs from the entry's: FF3 needs the account-currency figure (it
  // becomes the transaction amount), so an empty conversion field can't be saved — it would book
  // the typed number in the account's currency.
  const fxMissing = showFx && isDirty && !parsedForeignAmount;
  const impliedRate =
    showFx && parsedForeignAmount && amount !== '0'
      ? divideDecimal(parsedForeignAmount, amount, 2)
      : null;

  const formState: CaptureFormState = {
    type,
    amount,
    currencyCode: effectiveCurrencyCode ?? '',
    date,
    description,
    merchantRawInput,
    forceNewPayee,
    sourceId: effectiveSourceId,
    destinationId,
    categoryName,
    budgetId,
    notes,
    sharedWith,
    foreignAmount: showFx ? parsedForeignAmount : '',
    foreignCurrencyCode: showFx ? (accountCurrencyCode ?? null) : null,
  };

  const previewDraft: Draft = {
    type,
    amount,
    currencyCode: effectiveCurrencyCode ?? '',
    date: date.toISOString(),
    description: description || merchantRawInput || type,
    isNewPayee: forceNewPayee,
    sourceId: effectiveSourceId ?? undefined,
    sourceName: type === 'deposit' ? merchantRawInput : sourceAccount?.name,
    destinationId: destinationId ?? undefined,
    destinationName: type === 'withdrawal' ? merchantRawInput : destinationAccount?.name,
    categoryName: categoryName ?? undefined,
    budgetId: budgetId ?? undefined,
  };
  const readiness = draftReadiness(previewDraft);

  const confirmClose = useConfirmDiscard(isDirty, 'capture.discardTitle');

  function applyPayeeHistory(h: MerchantHistory) {
    set({ merchantRawInput: h.displayName, forceNewPayee: false });
    if (h.topCategory) set({ categoryName: h.topCategory });
    if (h.topAccountName) {
      const acc = assetAccounts.find((a) => a.name === h.topAccountName);
      if (acc) {
        if (type === 'withdrawal') set({ sourceId: acc.id });
        else if (type === 'deposit') set({ destinationId: acc.id });
      }
    }
    if (h.topBudgetName) {
      const b = budgets.find((x) => x.name === h.topBudgetName);
      if (b) set({ budgetId: b.id });
    }
  }

  function pickDate(mode: 'today' | 'yesterday') {
    set({ dateMode: mode, date: mode === 'today' ? new Date() : yesterday() });
    setSheet(null);
  }

  function openNativeDatePicker() {
    setSheet(null);
    // Starts from now's time, so a past day picked and the time dialog dismissed still keeps the
    // clock time rather than midnight (src/capture/entryDate.ts).
    pickDateTime(buildEntryDate(date, new Date()), (picked) => {
      set({ date: picked, dateMode: 'custom' });
    });
  }

  // Through act(): a failed Undo is reported instead of dropped while the snackbar closes and the
  // entry goes out anyway.
  const undoSend = act(
    tr('common.undo'),
    async (inboxItemId: string, confirmed: Awaited<ReturnType<typeof confirmInboxItem>>) => {
      const outcome = await undoConfirm(db, inboxItemId, confirmed);
      setToast(outcome === 'undone' ? tr('capture.undoneBackInInbox') : tr('inbox.alreadySent'));
    },
  );

  const save = act(
    tr('common.save'),
    async (andConfirm: boolean) => {
      const input = buildManualEntryInput(formState, assetAccounts);
      const { inboxItemId } = await createManualEntry(db, input);
      if (photoUri) await attachReceiptImage(db, inboxItemId, photoUri);
      const label = merchantRawInput || description || tr(labelKeyForType(type));
      haptics.tick();
      fly(formatAmountInput(amount, currency));
      if (andConfirm) {
        const confirmed = await confirmInboxItem(db, inboxItemId);
        // Same Undo the Inbox gives a confirm: the entry stays unsent while this is on screen.
        setSnackbar({
          id: inboxItemId,
          message: tr('capture.confirmedLabel', { label }),
          actionLabel: tr('common.undo'),
          onAction: () => void undoSend(inboxItemId, confirmed),
        });
      } else {
        setToast(tr('capture.savedLabel', { label }));
      }
      markSaved();
    },
    setToast,
  );
  const handleSave = (andConfirm: boolean) => {
    if (foreignAmountInvalid || fxMissing) return;
    if (andConfirm && !readiness.ready) {
      haptics.warn();
      shake();
      return;
    }
    void save(andConfirm);
  };

  const currency = currencyOf(currencies, effectiveCurrencyCode ?? '');
  const summaryParts = [merchantRawInput, categoryName].filter(Boolean);
  // What "More" holds besides the title, which has its own field: the key shows a dot when any of
  // it is set.
  const moreHasValue = !!(notes || sharedWith || photoUri);

  return (
    <Screen bottom>
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
          <CloseButton onPress={confirmClose} />
          <View style={{ flexDirection: 'row', flex: 1, gap: t.space.xs }}>
            {TX_TYPES.map((option) => (
              <Chip
                key={option.type}
                label={tr(option.labelKey)}
                selected={type === option.type}
                onPress={() => set({ type: option.type })}
              />
            ))}
          </View>
          <Pressable
            onPress={() => setSheet('currency')}
            accessibilityRole="button"
            accessibilityLabel={tr('capture.changeCurrency')}
          >
            <Text style={[t.type.heading, { color: t.color.text }]}>
              {effectiveCurrencyCode ?? '—'} ▾
            </Text>
          </Pressable>
        </View>

        <View style={{ alignItems: 'center', paddingVertical: t.space.xl }}>
          {/* Full width, so the floating ghost of a longer amount isn't clipped to the new "0". */}
          <View style={{ alignSelf: 'stretch', alignItems: 'center' }}>
            <Animated.Text
              style={[t.type.display, t.type.money, { color: t.color.text }, fieldStyle]}
              numberOfLines={1}
            >
              {formatAmountInput(amount, currency)}
            </Animated.Text>
            {!!ghost && (
              <Animated.Text
                key={ghost.key}
                pointerEvents="none"
                style={[
                  t.type.display,
                  t.type.money,
                  {
                    color: t.color.accent,
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                  },
                  ghostStyle,
                ]}
                numberOfLines={1}
              >
                {ghost.text}
              </Animated.Text>
            )}
          </View>
          {isDirty && !readiness.ready && (
            <Animated.Text
              style={[t.type.label, { color: t.color.warn, marginTop: t.space.xs }, shakeStyle]}
            >
              {needsLabel(readiness.missing)}
            </Animated.Text>
          )}
          {summaryParts.length > 0 && (
            <Text style={[t.type.body, { color: t.color.textMuted, marginTop: t.space.xs }]}>
              {summaryParts.join(' · ')}
            </Text>
          )}
          {!!aliasCaption && (
            <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>
              {aliasCaption}
            </Text>
          )}
        </View>

        {showFx && (
          <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {tr('capture.convertsTo', { amount, currency: effectiveCurrencyCode })}
            </Text>
            <TextField
              value={foreignAmount}
              onChangeText={(foreignAmount) => set({ foreignAmount })}
              keyboardType="decimal-pad"
              placeholder={`___ ${accountCurrencyCode}`}
              style={{ marginTop: t.space.xs }}
            />
            {!!impliedRate && !isNegative(impliedRate) && (
              <Text style={[t.type.label, { color: t.color.textFaint, marginTop: t.space.xs }]}>
                1 {effectiveCurrencyCode} ≈ {impliedRate} {accountCurrencyCode}
              </Text>
            )}
            {foreignAmountInvalid && (
              <Text style={[t.type.label, { color: t.color.danger, marginTop: t.space.xs }]}>
                {tr('common.invalidAmount')}
              </Text>
            )}
            {fxMissing && (
              <Text style={[t.type.label, { color: t.color.warn, marginTop: t.space.xs }]}>
                {tr('capture.enterAccountPaid', { currency: accountCurrencyCode })}
              </Text>
            )}
          </View>
        )}

        <TextField
          accessibilityLabel={tr('fields.description')}
          placeholder={tr('fields.description')}
          value={description}
          onChangeText={(description) => set({ description })}
          returnKeyType="done"
          style={{ marginHorizontal: t.space.lg, marginBottom: t.space.sm }}
        />

        <View style={{ gap: t.space.sm }}>
          {isPayeeType && (
            <View>
              <Text
                style={[t.type.label, { color: t.color.textFaint, paddingHorizontal: t.space.lg }]}
              >
                {type === 'deposit' ? tr('capture.payer') : tr('capture.payee')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={rowScroll}
                contentContainerStyle={{
                  paddingHorizontal: t.space.lg,
                  gap: t.space.sm,
                  paddingTop: t.space.xs,
                }}
              >
                <Chip
                  label="🔍"
                  accessibilityLabel={
                    type === 'deposit'
                      ? tr('payeeSheet.payer.search')
                      : tr('payeeSheet.payee.search')
                  }
                  onPress={() => setSheet('payee')}
                />
                {/* A payee picked from search (or typed as new) isn't necessarily among the top
                    suggestions; show it, selected, so the row says what was chosen. */}
                {!!merchantRawInput &&
                  !rankedPayees.some((h) => h.displayName === merchantRawInput) && (
                    <Chip label={merchantRawInput} selected onPress={() => setSheet('payee')} />
                  )}
                {rankedPayees.map((h) => (
                  <Chip
                    key={h.merchantKey}
                    label={h.displayName}
                    selected={merchantRawInput === h.displayName}
                    onPress={() => applyPayeeHistory(h)}
                  />
                ))}
              </ScrollView>
            </View>
          )}

          {type === 'transfer' ? (
            <>
              <AccountChipRow
                label={tr('fields.from')}
                searchLabel={tr('capture.searchSourceAccounts')}
                accounts={recentAccounts}
                selectedId={effectiveSourceId}
                onSearch={() => setSheet('accountSource')}
                onSelect={(id) => set({ sourceId: id })}
              />
              <AccountChipRow
                label={tr('fields.to')}
                searchLabel={tr('capture.searchDestinationAccounts')}
                accounts={recentAccounts.filter((a) => a.id !== effectiveSourceId)}
                selectedId={destinationId}
                onSearch={() => setSheet('accountDestination')}
                onSelect={(id) => set({ destinationId: id })}
              />
            </>
          ) : (
            <>
              <AccountChipRow
                label={type === 'deposit' ? tr('fields.to') : tr('fields.from')}
                searchLabel={tr('pickers.searchAccounts')}
                accounts={recentAccounts}
                selectedId={type === 'withdrawal' ? effectiveSourceId : destinationId}
                onSearch={() =>
                  setSheet(type === 'withdrawal' ? 'accountSource' : 'accountDestination')
                }
                onSelect={(id) =>
                  type === 'withdrawal' ? set({ sourceId: id }) : set({ destinationId: id })
                }
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={rowScroll}
                contentContainerStyle={{ paddingHorizontal: t.space.lg, gap: t.space.sm }}
              >
                <Chip
                  label={categoryName ?? tr('fields.category')}
                  selected={!!categoryName}
                  dotColor={categoryName ? categoryColor(categoryName, t.dark) : undefined}
                  onPress={() => setSheet('category')}
                />
                <Chip
                  label={budget?.name ?? tr('fields.budget')}
                  selected={!!budgetId}
                  onPress={() => setSheet('budget')}
                />
              </ScrollView>
            </>
          )}
        </View>

        <View style={{ flex: 1 }} />

        <Keypad
          onDigit={(key: KeypadKey) => pressKey(key, currency.decimalPlaces)}
          dateLabel={
            dateMode === 'today'
              ? `${tr('capture.today')} ▾`
              : dateMode === 'yesterday'
                ? `${tr('capture.yesterday')} ▾`
                : date.toLocaleString(appLocale(), {
                    day: 'numeric',
                    month: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
          }
          dateCompact={dateMode !== 'today' && dateMode !== 'yesterday'}
          onDatePress={() => setSheet('date')}
          onMorePress={() => setSheet('more')}
          moreHasValue={moreHasValue}
          saveLabel={tr('capture.saveAndConfirm')}
          onSave={() => handleSave(true)}
          saveDisabled={!readiness.ready || foreignAmountInvalid || fxMissing}
          saving={act.pending(tr('common.save'))}
        />
        <Pressable
          onPress={() => handleSave(false)}
          disabled={act.pending(tr('common.save')) || foreignAmountInvalid || fxMissing}
          style={{ alignItems: 'center', paddingVertical: t.space.md }}
        >
          <Text
            style={[
              t.type.body,
              {
                color: t.color.accent,
                fontWeight: '600',
                opacity:
                  act.pending(tr('common.save')) || foreignAmountInvalid || fxMissing ? 0.4 : 1,
              },
            ]}
          >
            {tr('capture.saveToInbox')}
          </Text>
        </Pressable>

        <Toast message={toast} />
        <Snackbar entry={snackbar} onDismiss={dismissSnackbar} bottom={t.space.lg} />
      </View>

      <Sheet visible={sheet === 'date'} onClose={() => setSheet(null)} title={tr('fields.date')}>
        <View style={{ gap: t.space.sm }}>
          <Button
            title={tr('capture.today')}
            variant={dateMode === 'today' ? 'primary' : 'secondary'}
            onPress={() => pickDate('today')}
          />
          <Button
            title={tr('capture.yesterday')}
            variant={dateMode === 'yesterday' ? 'primary' : 'secondary'}
            onPress={() => pickDate('yesterday')}
          />
          <Button
            title={tr('capture.pickDate')}
            variant="secondary"
            onPress={openNativeDatePicker}
          />
        </View>
      </Sheet>

      <PickerSheet
        visible={sheet === 'currency'}
        onClose={() => setSheet(null)}
        title={tr('fields.currency')}
        options={pickableCurrencies(currencies, effectiveCurrencyCode).map((c) => ({
          key: c.code,
          label: c.code,
        }))}
        selected={effectiveCurrencyCode}
        onSelect={(code) => code && set({ currencyCode: code })}
      />

      <PickerSheet
        visible={sheet === 'category'}
        onClose={() => setSheet(null)}
        title={tr('fields.category')}
        options={categories.map((c) => ({ key: c.name, label: c.name }))}
        selected={categoryName}
        onSelect={(categoryName) => set({ categoryName })}
        noneLabel={tr('common.none')}
      />

      <PickerSheet
        visible={sheet === 'budget'}
        onClose={() => setSheet(null)}
        title={tr('fields.budget')}
        options={budgets.map((b) => ({ key: b.id, label: b.name }))}
        selected={budgetId}
        onSelect={(budgetId) => set({ budgetId })}
        noneLabel={tr('common.none')}
      />

      <PayeeSheet
        visible={sheet === 'payee'}
        onClose={() => setSheet(null)}
        histories={histories}
        payeeLabel={type === 'deposit' ? 'payer' : 'payee'}
        onSelect={applyPayeeHistory}
        onCreateNew={(text) => {
          set({ merchantRawInput: text, forceNewPayee: true });
        }}
      />

      <AccountPickerSheet
        visible={!!accountSheetTarget}
        onClose={() => setSheet(null)}
        title={accountSheetTarget === 'source' ? tr('fields.from') : tr('fields.to')}
        accounts={assetAccounts}
        currencies={currencies}
        excludeId={
          accountSheetTarget === 'destination' && type === 'transfer' ? effectiveSourceId : null
        }
        onSelect={(a) =>
          accountSheetTarget === 'source' ? set({ sourceId: a.id }) : set({ destinationId: a.id })
        }
      />

      <Sheet
        visible={sheet === 'more'}
        onClose={() => setSheet(null)}
        title={tr('capture.more')}
        footer={<Button title={tr('common.done')} onPress={() => setSheet(null)} />}
      >
        <TextField
          placeholder={tr('fields.notes')}
          value={notes}
          onChangeText={(notes) => set({ notes })}
        />
        <TextField
          placeholder={tr('fields.sharedWith')}
          value={sharedWith}
          onChangeText={(sharedWith) => set({ sharedWith })}
        />
        <Row
          first
          label={tr('capture.receiptPhoto')}
          value={photoUri ? tr('capture.attached') : tr('capture.attach')}
          chevron
          onPress={attachPhoto}
        />
        {!!photoUri && (
          <Button
            title={tr('capture.removePhoto')}
            variant="ghost"
            onPress={() => set({ photoUri: null })}
          />
        )}
      </Sheet>
    </Screen>
  );
}
