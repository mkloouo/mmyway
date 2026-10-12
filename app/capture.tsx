// Capture (design §6.2) — amount first, one screen. The form scrolls above a pinned keypad only
// when the window is too short for both (a pop-up or split-screen window, landscape, a big font).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { appLocale } from '../src/i18n';
import { Animated, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useFlyAway, useShake } from '../src/ui/feedback';
import { pickDateTime } from '../src/ui/pickDate';
import { useConfirmDiscard } from '../src/ui/useConfirmDiscard';
import { useBudgets, useCategories, useCurrencies } from '../src/db/useReferenceData';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
import { useEnvelopeRemaining } from '../src/bucket/useEnvelopeRemaining';
import {
  Screen,
  Button,
  Sheet,
  Toast,
  Row,
  CloseButton,
  Card,
  Dot,
  PRESSED_OPACITY,
} from '../src/ui/components';
import { Segmented } from '../src/ui/kit';
import { Keypad } from '../src/ui/Keypad';
import { PayeeSheet } from '../src/ui/PayeeSheet';
import { AccountPickerSheet, type AccountPickerAccount } from '../src/ui/AccountPickerSheet';
import { currencyOf, formatAmountInput, formatMoney } from '../src/ui/money';
import { categoryColor } from '../src/ui/categoryColor';
import { haptics } from '../src/ui/haptics';

import { askPhotoSource, pickPhoto } from '../src/receipt/pickPhoto';
import { useAssetAccounts } from '../src/accounts/useAssetAccounts';
import { isDirtyAmount, type KeypadKey } from '../src/capture/amountInput';
import { buildEntryDate, yesterday } from '../src/capture/entryDate';
import { buildManualEntryInput, type CaptureFormState } from '../src/capture/buildManualEntryInput';
import { useCaptureDefaults } from '../src/capture/useCaptureDefaults';
import { useCaptureForm, type CaptureForm } from '../src/capture/useCaptureForm';
import { recentPosition, startPositionRequest } from '../src/capture/position';
import { captureKeyHeight } from '../src/capture/keyHeight';
import { attachReceiptImage } from '../src/inbox/updateDraft';
import { createManualEntry, confirmInboxItem, undoConfirm } from '../src/inbox/createManualEntry';
import { draftReadiness } from '../src/inbox/readiness';
import { accountLegCurrency, needsForeignAmount } from '../src/inbox/fx';
import {
  accountLastUsed,
  buildMerchantLookup,
  peekAccountLastUsed,
  peekMerchantLookup,
  type MerchantHistory,
} from '../src/lookup/merchantLookup';
import { useSharedPeople } from '../src/lookup/sharedPeople';
import { useRecentTags } from '../src/lookup/recentTags';
import { matchPayeeAlias } from '../src/lookup/aliases';
import { rankCandidates } from '../src/suggest/rank';
import { divideDecimal, isNegative, parseDecimalInput } from '../src/api/ff3/decimal';
import { useToast } from '../src/ui/useToast';
import { Snackbar, type SnackbarEntry } from '../src/ui/Snackbar';
import type { Draft } from '../src/inbox/draft';
import { needsLabel } from '../src/ui/readinessLabel';
import { TextField } from '../src/ui/TextField';
import { TagsField } from '../src/ui/TagsField';
import { SharedWithField } from '../src/ui/SharedWithField';
import { PickerSheet } from '../src/ui/PickerSheet';
import { useAction } from '../src/ui/useAction';
import { logLine } from '../src/utils/log';
import { errorMessage } from '../src/utils/errorMessage';
import { pickableCurrencies, primaryCurrencyCode } from '../src/ui/currencies';
import { TX_TYPES } from '../src/transactions/txTypes';

// Below this window height the amount is drawn smaller: every line it saves is one the form
// doesn't have to scroll.
const SHORT_WINDOW = 600;

/** A pill under the amount: the currency, the date, Details. `dot` marks a Details that holds something. */
function Pill({
  label,
  accessibilityLabel,
  onPress,
  dot,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  dot?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.xs,
        height: 30,
        paddingHorizontal: t.space.md,
        borderRadius: t.radius.pill,
        backgroundColor: t.color.surfaceAlt,
        opacity: pressed ? PRESSED_OPACITY : 1,
      })}
    >
      <Text style={[t.type.label, { color: t.color.text, fontWeight: '600' }]}>{label}</Text>
      {!!dot && <Dot color={t.color.accent} size={6} />}
    </Pressable>
  );
}

/** One suggestion in a field row. The chosen one is a filled accent chip. */
function SuggestChip({
  label,
  selected,
  onPress,
  dotColor,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  dotColor?: string;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.xs,
        height: 32,
        paddingHorizontal: t.space.md,
        borderRadius: t.radius.pill,
        borderWidth: 1,
        borderColor: selected ? t.color.accent : t.color.border,
        backgroundColor: selected ? t.color.accent : t.color.surface,
        opacity: pressed ? PRESSED_OPACITY : 1,
      })}
    >
      {!!dotColor && <Dot color={dotColor} />}
      <Text
        numberOfLines={1}
        style={[
          t.type.label,
          {
            color: selected ? t.color.onAccent : t.color.text,
            fontWeight: selected ? '600' : '400',
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One picker field of Capture's card: a grey key label, ONE horizontal row of suggestion chips and
 * a trailing 🔍 button that opens the full Choose sheet. A field that blocks confirming gets a warn
 * bar on its left edge and a warn label.
 */
function FieldRow({
  label,
  blocking,
  searchLabel,
  onSearch,
  children,
}: {
  label: string;
  blocking?: boolean;
  searchLabel: string;
  onSearch: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 48,
        borderTopWidth: 1,
        borderTopColor: t.color.border,
      }}
    >
      {!!blocking && <WarnBar />}
      <Text
        numberOfLines={1}
        style={[
          t.type.label,
          {
            width: 72,
            paddingLeft: t.space.lg,
            color: blocking ? t.color.warn : t.color.textFaint,
          },
        ]}
      >
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{
          alignItems: 'center',
          gap: t.space.sm,
          paddingLeft: t.space.sm,
          paddingRight: t.space.sm,
        }}
      >
        {children}
      </ScrollView>
      <Pressable
        onPress={onSearch}
        accessibilityRole="button"
        accessibilityLabel={searchLabel}
        hitSlop={4}
        style={({ pressed }) => ({
          width: 44,
          height: 48,
          alignItems: 'center',
          justifyContent: 'center',
          borderLeftWidth: 1,
          borderLeftColor: t.color.border,
          opacity: pressed ? PRESSED_OPACITY : 1,
        })}
      >
        <Ionicons name="search" size={18} color={t.color.accent} />
      </Pressable>
    </View>
  );
}

/** The 3 px warn bar on the left edge of a row that is blocking confirm. */
function WarnBar() {
  const t = useTheme();
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        backgroundColor: t.color.warn,
      }}
    />
  );
}

// The chip row shows a handful of choices, not a wall — the rest live behind the 🔍 button's
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

/** A field row of account chips. Capture draws this for from, to, and the single account of a non-transfer. */
function AccountFieldRow({
  label,
  searchLabel,
  accounts,
  selectedId,
  blocking,
  onSearch,
  onSelect,
}: {
  label: string;
  searchLabel: string;
  accounts: AccountPickerAccount[];
  selectedId: string | null | undefined;
  blocking?: boolean;
  onSearch: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <FieldRow label={label} searchLabel={searchLabel} onSearch={onSearch} blocking={blocking}>
      {topChips(accounts, selectedId).map((a) => (
        <SuggestChip
          key={a.id}
          label={a.name}
          selected={selectedId === a.id}
          onPress={() => onSelect(a.id)}
        />
      ))}
    </FieldRow>
  );
}

function labelKeyForType(t: Draft['type']): string {
  return TX_TYPES.find((x) => x.type === t)!.labelKey;
}

export default function CaptureScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  // Visual twins of the haptics below (src/ui/feedback.ts): a refused Save & confirm shakes what's
  // missing; a save floats the saved amount away while the cleared field fades in.
  const { shake, shakeStyle } = useShake();
  const { fly, ghost, ghostStyle, fieldStyle } = useFlyAway();
  const { defaultAccountId, defaultCurrencyCode } = useCaptureDefaults();
  const window = useWindowDimensions();
  const keyHeight = captureKeyHeight(window);
  const short = window.height < SHORT_WINDOW;
  const amountType = short ? t.type.title : t.type.display;

  const assetAccountRows = useAssetAccounts({ includeLiabilities: true });
  const assetAccounts = useMemo(() => assetAccountRows ?? [], [assetAccountRows]);
  const categories = useCategories();
  const sharedPeople = useSharedPeople();
  const recentTags = useRecentTags();
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
    tags,
    sharedWith,
    foreignAmount,
    photoUri,
    set,
    pressKey,
    markSaved,
  } = useCaptureForm();

  // A route can preset the entry: a reminder's "Move money" opens a transfer into one account
  // (?type=transfer&to=<accountId>). Applied whenever those params change, so a second route with
  // other params still takes effect on an open screen.
  const params = useLocalSearchParams<{ type?: string; to?: string }>();
  useEffect(() => {
    const patch: Partial<CaptureForm> = {};
    const preset = TX_TYPES.find((x) => x.type === params.type);
    if (preset) patch.type = preset.type;
    if (params.to) patch.destinationId = params.to;
    if (Object.keys(patch).length > 0) set(patch);
  }, [params.type, params.to, set]);

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
  // Where this is being typed (#67): asked for as the screen opens, and whatever has arrived by
  // the time Save is tapped goes on the entry. Nothing waits for it, and nothing fails without it.
  useEffect(() => {
    startPositionRequest(db);
  }, [db]);
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
    matchPayeeAlias(db, merchantRawInput)
      .then((match) => {
        if (cancelled) return;
        const caption =
          match.matched && match.payeeName !== merchantRawInput
            ? tr('capture.booksViaAlias', { name: match.payeeName })
            : null;
        setMatchedFor({ text: merchantRawInput, caption });
      })
      .catch((err) => logLine('warn', `alias match failed: ${errorMessage(err)}`));
    return () => {
      cancelled = true;
    };
  }, [db, isPayeeType, merchantRawInput, tr]);
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
  // What is left in that envelope this month, from the Budget tab's cache (src/bucket/).
  const envelopeLeft = useEnvelopeRemaining(budgetId);

  // FX (design §6.2): reveal when the account leg's currency differs from the chosen currency.
  // The same rule as the draft screen's, from src/inbox/fx.ts.
  const accountCurrencyCode = accountLegCurrency(
    type,
    effectiveCurrencyCode,
    sourceAccount?.currencyCode,
    destinationAccount?.currencyCode,
  );
  const showFx = needsForeignAmount(accountCurrencyCode, effectiveCurrencyCode);
  // The account whose currency is the foreign one: its name labels the FX row.
  const fxAccount =
    type === 'deposit'
      ? destinationAccount
      : type === 'withdrawal'
        ? sourceAccount
        : sourceAccount?.currencyCode === effectiveCurrencyCode
          ? destinationAccount
          : sourceAccount;
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
    date: dateMode === 'today' ? new Date() : date,
    description,
    merchantRawInput,
    forceNewPayee,
    sourceId: effectiveSourceId,
    destinationId,
    categoryName,
    budgetId,
    notes,
    tags,
    sharedWith,
    foreignAmount: showFx ? parsedForeignAmount : '',
    foreignCurrencyCode: showFx ? (accountCurrencyCode ?? null) : null,
    location: recentPosition(),
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
  // Which field a missing piece belongs to: that row gets the warn bar. Only once something is typed,
  // the same as the "Needs … to confirm" line.
  const blocks = (missing: string) => isDirty && readiness.missing.includes(missing);

  const confirmClose = useConfirmDiscard(isDirty, 'capture.discardTitle');

  function applyPayeeHistory(h: MerchantHistory) {
    set({ merchantRawInput: h.displayName, forceNewPayee: false });
    if (h.topCategory) set({ categoryName: h.topCategory });
    if (h.topAccountName) {
      const acc = assetAccounts.find((a) => a.name === h.topAccountName);
      if (acc) {
        const patch: Partial<CaptureForm> =
          type === 'withdrawal' ? { sourceId: acc.id } : { destinationId: acc.id };
        if (!isDirty && acc.currencyCode) {
          patch.currencyCode = acc.currencyCode;
        }
        set(patch);
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
  // The Details sheet holds the notes, tags, who it is shared with and a photo; its pill shows a dot
  // when any of it is set (the title has its own field).
  const moreHasValue = !!(notes || tags.length > 0 || sharedWith || photoUri);
  const saving = act.pending(tr('common.save'));
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
  const fxAccountName = fxAccount?.name ?? accountCurrencyCode;

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
          <CloseButton onPress={confirmClose} />
          <View style={{ flex: 1 }}>
            <Segmented
              options={TX_TYPES.map((option) => ({ key: option.type, label: tr(option.labelKey) }))}
              value={type}
              onChange={(next) => set({ type: next })}
            />
          </View>
        </View>

        <View style={{ alignItems: 'center', paddingVertical: short ? t.space.sm : t.space.lg }}>
          {/* Full width, so the floating ghost of a longer amount isn't clipped to the new "0". */}
          <View style={{ alignSelf: 'stretch', alignItems: 'center' }}>
            <Animated.Text
              style={[amountType, t.type.money, { color: t.color.text }, fieldStyle]}
              numberOfLines={1}
            >
              {formatAmountInput(amount, currency)}
            </Animated.Text>
            {!!ghost && (
              <Animated.Text
                key={ghost.key}
                pointerEvents="none"
                style={[
                  amountType,
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
            <Animated.View
              style={[
                {
                  marginTop: t.space.sm,
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: t.color.warnSoft,
                  borderRadius: t.radius.pill,
                  paddingHorizontal: t.space.md,
                  paddingVertical: t.space.xs,
                },
                shakeStyle,
              ]}
            >
              <Text style={[t.type.label, { color: t.color.warn }]}>
                {needsLabel(readiness.missing)}
              </Text>
            </Animated.View>
          )}
          <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: t.space.sm }}>
            <Pill
              label={`${effectiveCurrencyCode ?? '—'} ▾`}
              accessibilityLabel={tr('capture.changeCurrency')}
              onPress={() => setSheet('currency')}
            />
            <Pill
              label={`${dateText} ▾`}
              accessibilityLabel={tr('fields.date')}
              onPress={() => setSheet('date')}
            />
            <Pill
              label={tr('capture.details')}
              dot={moreHasValue}
              onPress={() => setSheet('more')}
            />
          </View>
          {!!aliasCaption && (
            <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>
              {aliasCaption}
            </Text>
          )}
        </View>

        {/* The amount stays in view; what's under it scrolls when the window is too short for it
            and the keypad (pop-up, split screen, landscape). On a phone it all fits. */}
        <ScrollView
          style={{ flexGrow: 0, flexShrink: 1 }}
          contentContainerStyle={{ paddingBottom: t.space.sm }}
          keyboardShouldPersistTaps="handled"
        >
          <Card flush style={{ marginHorizontal: t.space.lg }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 48,
                paddingLeft: t.space.lg,
                paddingRight: t.space.lg,
                gap: t.space.sm,
              }}
            >
              <Text style={[t.type.label, { width: 72, color: t.color.textFaint }]}>
                {tr('fields.description')}
              </Text>
              <TextField
                testID="capture-title"
                accessibilityLabel={tr('fields.description')}
                value={description}
                onChangeText={(description) => set({ description })}
                returnKeyType="done"
                style={{
                  flex: 1,
                  minWidth: 0,
                  borderWidth: 0,
                  paddingHorizontal: 0,
                  backgroundColor: 'transparent',
                  fontSize: 15,
                }}
              />
            </View>

            {isPayeeType && (
              <FieldRow
                label={type === 'deposit' ? tr('capture.payer') : tr('capture.payee')}
                blocking={blocks('payee')}
                searchLabel={
                  type === 'deposit' ? tr('payeeSheet.payer.search') : tr('payeeSheet.payee.search')
                }
                onSearch={() => setSheet('payee')}
              >
                {/* A payee picked from search (or typed as new) isn't necessarily among the top
                  suggestions; show it, selected, so the row says what was chosen. */}
                {!!merchantRawInput &&
                  !rankedPayees.some((h) => h.displayName === merchantRawInput) && (
                    <SuggestChip
                      label={merchantRawInput}
                      selected
                      onPress={() => setSheet('payee')}
                    />
                  )}
                {rankedPayees.map((h) => (
                  <SuggestChip
                    key={h.merchantKey}
                    label={h.displayName}
                    selected={merchantRawInput === h.displayName}
                    onPress={() => applyPayeeHistory(h)}
                  />
                ))}
              </FieldRow>
            )}

            {type === 'transfer' ? (
              <>
                <AccountFieldRow
                  label={tr('fields.from')}
                  searchLabel={tr('capture.searchSourceAccounts')}
                  accounts={recentAccounts}
                  selectedId={effectiveSourceId}
                  blocking={blocks('source account')}
                  onSearch={() => setSheet('accountSource')}
                  onSelect={(id) => {
                    const acct = assetAccounts.find((a) => a.id === id);
                    const patch: Partial<CaptureForm> = { sourceId: id };
                    if (!isDirty && acct?.currencyCode) {
                      patch.currencyCode = acct.currencyCode;
                    }
                    set(patch);
                  }}
                />
                <AccountFieldRow
                  label={tr('fields.to')}
                  searchLabel={tr('capture.searchDestinationAccounts')}
                  accounts={recentAccounts.filter((a) => a.id !== effectiveSourceId)}
                  selectedId={destinationId}
                  blocking={blocks('destination account')}
                  onSearch={() => setSheet('accountDestination')}
                  onSelect={(id) => set({ destinationId: id })}
                />
              </>
            ) : (
              <AccountFieldRow
                label={type === 'deposit' ? tr('fields.to') : tr('fields.from')}
                searchLabel={tr('pickers.searchAccounts')}
                accounts={recentAccounts}
                selectedId={type === 'withdrawal' ? effectiveSourceId : destinationId}
                blocking={blocks(type === 'deposit' ? 'destination account' : 'source account')}
                onSearch={() =>
                  setSheet(type === 'withdrawal' ? 'accountSource' : 'accountDestination')
                }
                onSelect={(id) => {
                  const acct = assetAccounts.find((a) => a.id === id);
                  const patch: Partial<CaptureForm> =
                    type === 'withdrawal' ? { sourceId: id } : { destinationId: id };
                  if (!isDirty && acct?.currencyCode) {
                    patch.currencyCode = acct.currencyCode;
                  }
                  set(patch);
                }}
              />
            )}

            {showFx && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  minHeight: 48,
                  paddingLeft: t.space.lg,
                  paddingRight: t.space.lg,
                  gap: t.space.sm,
                  borderTopWidth: 1,
                  borderTopColor: t.color.border,
                }}
              >
                {fxMissing && <WarnBar />}
                <Text
                  numberOfLines={2}
                  style={[
                    t.type.label,
                    {
                      width: 72,
                      color: fxMissing ? t.color.warn : t.color.textFaint,
                    },
                  ]}
                >
                  {tr('capture.accountPaid', { account: fxAccountName })}
                </Text>
                <TextField
                  value={foreignAmount}
                  onChangeText={(foreignAmount) => set({ foreignAmount })}
                  keyboardType="decimal-pad"
                  placeholder={`___ ${accountCurrencyCode}`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    borderWidth: 0,
                    paddingHorizontal: 0,
                    backgroundColor: 'transparent',
                    fontSize: 17,
                    fontWeight: '600',
                  }}
                />
                {!!impliedRate && !isNegative(impliedRate) && (
                  <Text numberOfLines={1} style={[t.type.label, { color: t.color.textFaint }]}>
                    1 {effectiveCurrencyCode} ≈ {impliedRate} {accountCurrencyCode}
                  </Text>
                )}
              </View>
            )}

            {type !== 'transfer' && (
              <>
                <FieldRow
                  label={tr('fields.category')}
                  searchLabel={tr('capture.searchCategories')}
                  onSearch={() => setSheet('category')}
                >
                  <SuggestChip
                    label={categoryName ?? tr('common.none')}
                    selected={!!categoryName}
                    dotColor={categoryName ? categoryColor(categoryName, t.dark) : undefined}
                    onPress={() => setSheet('category')}
                    testID="capture-category"
                  />
                </FieldRow>
                <FieldRow
                  label={tr('fields.budget')}
                  searchLabel={tr('capture.searchBudgets')}
                  onSearch={() => setSheet('budget')}
                >
                  <SuggestChip
                    label={budget?.name ?? tr('common.none')}
                    selected={!!budgetId}
                    onPress={() => setSheet('budget')}
                  />
                </FieldRow>
                {/* What is left in the chosen envelope this month (the Budget tab's own number,
                    read from its cache — no extra request). Shown while entering, which is the
                    moment it is worth knowing. */}
                {!!budget && envelopeLeft !== null && (
                  <Text
                    style={[
                      t.type.label,
                      {
                        color: isNegative(envelopeLeft) ? t.color.warn : t.color.textMuted,
                        paddingHorizontal: t.space.lg,
                        paddingBottom: t.space.sm,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {isNegative(envelopeLeft)
                      ? tr('budget.envelopeOverIn', {
                          name: budget.name,
                          amount: formatMoney(envelopeLeft.replace(/^[-−]/, ''), currency),
                        })
                      : tr('budget.envelopeLeftIn', {
                          name: budget.name,
                          amount: formatMoney(envelopeLeft, currency),
                        })}
                  </Text>
                )}
              </>
            )}
          </Card>

          {foreignAmountInvalid && (
            <Text
              style={[
                t.type.label,
                { color: t.color.danger, paddingHorizontal: t.space.lg, marginTop: t.space.sm },
              ]}
            >
              {tr('common.invalidAmount')}
            </Text>
          )}
          {fxMissing && (
            <Text
              style={[
                t.type.label,
                { color: t.color.warn, paddingHorizontal: t.space.lg, marginTop: t.space.sm },
              ]}
            >
              {tr('capture.enterAccountPaid', { currency: accountCurrencyCode })}
            </Text>
          )}
        </ScrollView>

        <View style={{ flex: 1 }} />

        <Keypad
          keyHeight={keyHeight}
          onDigit={(key: KeypadKey) => pressKey(key, currency.decimalPlaces)}
        />
        <View
          style={{
            flexDirection: 'row',
            gap: t.space.sm,
            paddingHorizontal: t.space.lg,
            paddingTop: t.space.xs,
            paddingBottom: t.space.lg,
          }}
        >
          <Button
            title={tr('capture.toInbox')}
            variant="secondary"
            size="lg"
            style={{ flex: 1 }}
            disabled={saving || foreignAmountInvalid || fxMissing}
            onPress={() => handleSave(false)}
          />
          <Button
            title={tr('capture.saveAndConfirm')}
            size="lg"
            style={{ flex: 2 }}
            disabled={!readiness.ready || foreignAmountInvalid || fxMissing || saving}
            onPress={() => handleSave(true)}
          />
        </View>

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
        onSelect={(a) => {
          const patch: Partial<CaptureForm> =
            accountSheetTarget === 'source' ? { sourceId: a.id } : { destinationId: a.id };
          if (
            !isDirty &&
            a.currencyCode &&
            (type !== 'transfer' || accountSheetTarget === 'source')
          ) {
            patch.currencyCode = a.currencyCode;
          }
          set(patch);
        }}
      />

      <Sheet
        visible={sheet === 'more'}
        onClose={() => setSheet(null)}
        title={tr('capture.details')}
        footer={<Button title={tr('common.done')} onPress={() => setSheet(null)} />}
      >
        <Card flush>
          <View style={{ padding: t.space.lg }}>
            <TextField
              placeholder={tr('fields.notes')}
              value={notes}
              onChangeText={(notes) => set({ notes })}
              style={{ borderWidth: 0, paddingHorizontal: 0, backgroundColor: 'transparent' }}
            />
          </View>
          <View style={{ padding: t.space.lg, borderTopWidth: 1, borderTopColor: t.color.border }}>
            <TagsField tags={tags} onChange={(tags) => set({ tags })} suggestions={recentTags} />
          </View>
          <View style={{ padding: t.space.lg, borderTopWidth: 1, borderTopColor: t.color.border }}>
            <SharedWithField
              live
              value={sharedWith}
              people={sharedPeople}
              onApply={(sharedWith) => set({ sharedWith })}
            />
          </View>
        </Card>
        <Card flush>
          <Row
            first
            label={tr('capture.receiptPhoto')}
            value={photoUri ? tr('capture.attached') : tr('capture.attach')}
            chevron
            onPress={attachPhoto}
          />
        </Card>
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
