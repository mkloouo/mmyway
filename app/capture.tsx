// Capture (design §6.2) — amount first, one screen, no scrolling for the common case.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { appLocale } from '../src/i18n';
import { Animated, Alert, BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import { useFlyAway, useShake } from '../src/ui/feedback';
import { router } from 'expo-router';
import { pickDateTime } from '../src/ui/pickDate';
import { useLiveQuery } from '../src/db/useLiveQuery';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
import { Screen, Chip, Button, Sheet, Toast, Row } from '../src/ui/components';
import { Keypad } from '../src/ui/Keypad';
import { PayeeSheet } from '../src/ui/PayeeSheet';
import { AccountPickerSheet, type AccountPickerAccount } from '../src/ui/AccountPickerSheet';
import { currencyOf, formatAmountInput } from '../src/ui/money';
import { categoryColor } from '../src/ui/categoryColor';
import { haptics } from '../src/ui/haptics';
import { referenceCategories, referenceBudgets, referenceCurrencies } from '../src/db/schema';
import { askPhotoSource, pickPhoto } from '../src/receipt/pickPhoto';
import { useAssetAccounts } from '../src/accounts/useAssetAccounts';
import { applyDigit, type KeypadKey } from '../src/capture/amountInput';
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
import { reportErrors } from '../src/ui/reportError';
import { useToast } from '../src/ui/useToast';
import { Snackbar, type SnackbarEntry } from '../src/ui/Snackbar';
import type { Draft } from '../src/inbox/draft';
import { needsLabel } from '../src/ui/readinessLabel';
import { TextField } from '../src/ui/TextField';
import { PickerSheet } from '../src/ui/PickerSheet';
import { useAction } from '../src/ui/useAction';
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
  const { data: categories } = useLiveQuery(db.select().from(referenceCategories));
  const { data: budgets } = useLiveQuery(db.select().from(referenceBudgets));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));

  const {
    type,
    setType,
    amount,
    setAmount,
    currencyCode,
    setCurrencyCode,
    date,
    setDate,
    dateMode,
    setDateMode,
    merchantRawInput,
    setMerchantRawInput,
    forceNewPayee,
    setForceNewPayee,
    sourceId,
    setSourceId,
    destinationId,
    setDestinationId,
    categoryName,
    setCategoryName,
    budgetId,
    setBudgetId,
    description,
    setDescription,
    notes,
    setNotes,
    sharedWith,
    setSharedWith,
    foreignAmount,
    setForeignAmount,
    photoUri,
    setPhotoUri,
    markSaved,
  } = useCaptureForm();
  const attachPhoto = act(tr('capture.receiptPhoto'), async () => {
    const source = await askPhotoSource();
    if (!source) return;
    const photo = await pickPhoto(source);
    if (photo) setPhotoUri(photo.uri);
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useToast();
  const [snackbar, setSnackbar] = useState<SnackbarEntry | null>(null);
  const dismissSnackbar = useCallback(() => setSnackbar(null), []);

  const [payeeSheetOpen, setPayeeSheetOpen] = useState(false);
  const [accountSheetTarget, setAccountSheetTarget] = useState<'source' | 'destination' | null>(
    null,
  );
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);

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
    buildMerchantLookup(db, { type: lookupType }).then((map) => {
      if (!cancelled) setLoaded({ type: lookupType, list: [...map.values()] });
    });
    accountLastUsed(db).then((m) => {
      if (!cancelled) setAccountRecency(m);
    });
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
    matchAlias(db, PAYEE, merchantRawInput).then((match) => {
      if (cancelled) return;
      const caption =
        match.matched && match.alias.targetName !== merchantRawInput
          ? i18n.t('capture.booksViaAlias', { name: match.alias.targetName })
          : null;
      setMatchedFor({ text: merchantRawInput, caption });
    });
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
  const budget = (budgets ?? []).find((b) => b.id === budgetId);

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

  const confirmClose = useCallback(() => {
    if (!isDirty) {
      router.back();
      return;
    }
    Alert.alert(tr('capture.discardTitle'), undefined, [
      { text: tr('capture.keepEditing'), style: 'cancel' },
      { text: tr('inbox.discard'), style: 'destructive', onPress: () => router.back() },
    ]);
  }, [isDirty, tr]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isDirty) {
        confirmClose();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [isDirty, confirmClose]);

  function applyPayeeHistory(h: MerchantHistory) {
    setMerchantRawInput(h.displayName);
    setForceNewPayee(false);
    if (h.topCategory) setCategoryName(h.topCategory);
    if (h.topAccountName) {
      const acc = assetAccounts.find((a) => a.name === h.topAccountName);
      if (acc) {
        if (type === 'withdrawal') setSourceId(acc.id);
        else if (type === 'deposit') setDestinationId(acc.id);
      }
    }
    if (h.topBudgetName) {
      const b = (budgets ?? []).find((x) => x.name === h.topBudgetName);
      if (b) setBudgetId(b.id);
    }
  }

  function pickDate(mode: 'today' | 'yesterday') {
    setDateMode(mode);
    setDate(mode === 'today' ? new Date() : yesterday());
    setDateSheetOpen(false);
  }

  function openNativeDatePicker() {
    setDateSheetOpen(false);
    // Starts from now's time, so a past day picked and the time dialog dismissed still keeps the
    // clock time rather than midnight (src/capture/entryDate.ts).
    pickDateTime(buildEntryDate(date, new Date()), (picked) => {
      setDate(picked);
      setDateMode('custom');
    });
  }

  async function handleSave(andConfirm: boolean) {
    if (saving || foreignAmountInvalid || fxMissing) return;
    if (andConfirm && !readiness.ready) {
      haptics.warn();
      shake();
      return;
    }
    setSaving(true);
    try {
      await reportErrors(
        tr('common.save'),
        async () => {
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
              onAction: async () => {
                const outcome = await undoConfirm(db, inboxItemId, confirmed);
                setToast(
                  outcome === 'undone' ? tr('capture.undoneBackInInbox') : tr('inbox.alreadySent'),
                );
              },
            });
          } else {
            setToast(tr('capture.savedLabel', { label }));
          }
          markSaved();
        },
        setToast,
      );
    } finally {
      setSaving(false);
    }
  }

  const currency = currencyOf(currencies ?? [], effectiveCurrencyCode ?? '');
  const summaryParts = [merchantRawInput, categoryName].filter(Boolean);
  const detailsParts = [
    description,
    notes,
    sharedWith && tr('inbox.sharedWith', { name: sharedWith }),
    photoUri && tr('capture.photo'),
  ].filter(Boolean);
  const detailsLabel = detailsParts.length > 0 ? detailsParts.join(' · ') : tr('capture.details');

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
          <Pressable
            onPress={confirmClose}
            accessibilityRole="button"
            accessibilityLabel={tr('common.close')}
          >
            <Text style={[t.type.heading, { color: t.color.text }]}>✕</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', flex: 1, gap: t.space.xs }}>
            {TX_TYPES.map((option) => (
              <Chip
                key={option.type}
                label={tr(option.labelKey)}
                selected={type === option.type}
                onPress={() => setType(option.type)}
              />
            ))}
          </View>
          <Pressable onPress={() => setCurrencySheetOpen(true)} accessibilityRole="button">
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
              onChangeText={setForeignAmount}
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
                  onPress={() => setPayeeSheetOpen(true)}
                />
                {/* A payee picked from search (or typed as new) isn't necessarily among the top
                    suggestions; show it, selected, so the row says what was chosen. */}
                {!!merchantRawInput &&
                  !rankedPayees.some((h) => h.displayName === merchantRawInput) && (
                    <Chip
                      label={merchantRawInput}
                      selected
                      onPress={() => setPayeeSheetOpen(true)}
                    />
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
              <View>
                <Text
                  style={[
                    t.type.label,
                    { color: t.color.textFaint, paddingHorizontal: t.space.lg },
                  ]}
                >
                  {tr('fields.from')}
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
                    accessibilityLabel={tr('capture.searchSourceAccounts')}
                    onPress={() => setAccountSheetTarget('source')}
                  />
                  {topChips(recentAccounts, effectiveSourceId).map((a) => (
                    <Chip
                      key={a.id}
                      label={a.name}
                      selected={effectiveSourceId === a.id}
                      onPress={() => setSourceId(a.id)}
                    />
                  ))}
                </ScrollView>
              </View>
              <View>
                <Text
                  style={[
                    t.type.label,
                    { color: t.color.textFaint, paddingHorizontal: t.space.lg },
                  ]}
                >
                  {tr('fields.to')}
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
                    accessibilityLabel={tr('capture.searchDestinationAccounts')}
                    onPress={() => setAccountSheetTarget('destination')}
                  />
                  {topChips(
                    recentAccounts.filter((a) => a.id !== effectiveSourceId),
                    destinationId,
                  ).map((a) => (
                    <Chip
                      key={a.id}
                      label={a.name}
                      selected={destinationId === a.id}
                      onPress={() => setDestinationId(a.id)}
                    />
                  ))}
                  <Chip
                    label={detailsLabel}
                    selected={detailsParts.length > 0}
                    onPress={() => setMoreSheetOpen(true)}
                  />
                </ScrollView>
              </View>
            </>
          ) : (
            <>
              <View>
                <Text
                  style={[
                    t.type.label,
                    { color: t.color.textFaint, paddingHorizontal: t.space.lg },
                  ]}
                >
                  {type === 'deposit' ? tr('fields.to') : tr('fields.from')}
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
                    accessibilityLabel={tr('pickers.searchAccounts')}
                    onPress={() =>
                      setAccountSheetTarget(type === 'withdrawal' ? 'source' : 'destination')
                    }
                  />
                  {topChips(
                    recentAccounts,
                    type === 'withdrawal' ? effectiveSourceId : destinationId,
                  ).map((a) => (
                    <Chip
                      key={a.id}
                      label={a.name}
                      selected={
                        (type === 'withdrawal' ? effectiveSourceId : destinationId) === a.id
                      }
                      onPress={() =>
                        type === 'withdrawal' ? setSourceId(a.id) : setDestinationId(a.id)
                      }
                    />
                  ))}
                </ScrollView>
              </View>
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
                  onPress={() => setCategorySheetOpen(true)}
                />
                <Chip
                  label={budget?.name ?? tr('fields.budget')}
                  selected={!!budgetId}
                  onPress={() => setBudgetSheetOpen(true)}
                />
                <Chip
                  label={detailsLabel}
                  selected={detailsParts.length > 0}
                  onPress={() => setMoreSheetOpen(true)}
                />
              </ScrollView>
            </>
          )}
        </View>

        <View style={{ flex: 1 }} />

        <Keypad
          onDigit={(key: KeypadKey) =>
            setAmount((cur) => applyDigit(cur, key, currency.decimalPlaces))
          }
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
          onDatePress={() => setDateSheetOpen(true)}
          onNotePress={() => setMoreSheetOpen(true)}
          noteHasValue={!!notes}
          saveLabel={tr('capture.saveAndConfirm')}
          onSave={() => handleSave(true)}
          saveDisabled={!readiness.ready || foreignAmountInvalid || fxMissing}
          saving={saving}
        />
        <Pressable
          onPress={() => handleSave(false)}
          disabled={saving || foreignAmountInvalid || fxMissing}
          style={{ alignItems: 'center', paddingVertical: t.space.md }}
        >
          <Text
            style={[
              t.type.body,
              {
                color: t.color.accent,
                fontWeight: '600',
                opacity: saving || foreignAmountInvalid || fxMissing ? 0.4 : 1,
              },
            ]}
          >
            {tr('capture.saveToInbox')}
          </Text>
        </Pressable>

        <Toast message={toast} />
        <Snackbar entry={snackbar} onDismiss={dismissSnackbar} bottom={t.space.lg} />
      </View>

      <Sheet
        visible={dateSheetOpen}
        onClose={() => setDateSheetOpen(false)}
        title={tr('fields.date')}
      >
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
        visible={currencySheetOpen}
        onClose={() => setCurrencySheetOpen(false)}
        title={tr('fields.currency')}
        options={pickableCurrencies(currencies, effectiveCurrencyCode).map((c) => ({
          key: c.code,
          label: c.code,
        }))}
        selected={effectiveCurrencyCode}
        onSelect={(code) => code && setCurrencyCode(code)}
      />

      <PickerSheet
        visible={categorySheetOpen}
        onClose={() => setCategorySheetOpen(false)}
        title={tr('fields.category')}
        options={(categories ?? []).map((c) => ({ key: c.name, label: c.name }))}
        selected={categoryName}
        onSelect={setCategoryName}
        noneLabel={tr('common.none')}
      />

      <PickerSheet
        visible={budgetSheetOpen}
        onClose={() => setBudgetSheetOpen(false)}
        title={tr('fields.budget')}
        options={(budgets ?? []).map((b) => ({ key: b.id, label: b.name }))}
        selected={budgetId}
        onSelect={setBudgetId}
        noneLabel={tr('common.none')}
      />

      <PayeeSheet
        visible={payeeSheetOpen}
        onClose={() => setPayeeSheetOpen(false)}
        histories={histories}
        payeeLabel={type === 'deposit' ? 'payer' : 'payee'}
        onSelect={applyPayeeHistory}
        onCreateNew={(text) => {
          setMerchantRawInput(text);
          setForceNewPayee(true);
        }}
      />

      <AccountPickerSheet
        visible={!!accountSheetTarget}
        onClose={() => setAccountSheetTarget(null)}
        title={accountSheetTarget === 'source' ? tr('fields.from') : tr('fields.to')}
        accounts={assetAccounts}
        currencies={currencies ?? []}
        excludeId={
          accountSheetTarget === 'destination' && type === 'transfer' ? effectiveSourceId : null
        }
        onSelect={(a) =>
          accountSheetTarget === 'source' ? setSourceId(a.id) : setDestinationId(a.id)
        }
      />

      <Sheet
        visible={moreSheetOpen}
        onClose={() => setMoreSheetOpen(false)}
        title={tr('capture.more')}
        footer={<Button title={tr('common.done')} onPress={() => setMoreSheetOpen(false)} />}
      >
        <TextField
          placeholder={tr('fields.description')}
          value={description}
          onChangeText={setDescription}
        />
        <TextField placeholder={tr('fields.notes')} value={notes} onChangeText={setNotes} />
        <TextField
          placeholder={tr('fields.sharedWith')}
          value={sharedWith}
          onChangeText={setSharedWith}
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
            onPress={() => setPhotoUri(null)}
          />
        )}
      </Sheet>
    </Screen>
  );
}
