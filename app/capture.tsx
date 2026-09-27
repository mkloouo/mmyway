// Capture (design §6.2) — amount first, one screen, no scrolling for the common case.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
import { Screen, Chip, Button, Sheet, Money } from '../src/ui/components';
import { Keypad } from '../src/ui/Keypad';
import { PayeeSheet } from '../src/ui/PayeeSheet';
import { currencyOf } from '../src/ui/money';
import { categoryColor } from '../src/ui/categoryColor';
import { haptics } from '../src/ui/haptics';
import { referenceAccounts, referenceCategories, referenceBudgets, referenceCurrencies } from '../src/db/schema';
import { applyDigit, type KeypadKey } from '../src/capture/amountInput';
import { buildEntryDate, yesterday } from '../src/capture/entryDate';
import { buildManualEntryInput, type CaptureFormState } from '../src/capture/buildManualEntryInput';
import { useCaptureDefaults } from '../src/capture/useCaptureDefaults';
import { createManualEntry, confirmInboxItem } from '../src/inbox/createManualEntry';
import { draftReadiness } from '../src/inbox/readiness';
import { buildMerchantLookup, type MerchantHistory } from '../src/lookup/merchantLookup';
import { matchAlias } from '../src/lookup/aliases';
import { rankCandidates } from '../src/suggest/rank';
import { divideDecimal, isNegative } from '../src/api/ff3/decimal';
import type { Draft } from '../src/inbox/draft';

const TYPES: { type: Draft['type']; label: string }[] = [
  { type: 'withdrawal', label: 'Expense' },
  { type: 'deposit', label: 'Income' },
  { type: 'transfer', label: 'Transfer' },
];

function labelForType(t: Draft['type']): string {
  return TYPES.find((x) => x.type === t)!.label;
}

export default function CaptureScreen() {
  const db = useDb();
  const t = useTheme();
  const { defaultAccountId, defaultCurrencyCode } = useCaptureDefaults();

  const { data: accountRows } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: categories } = useLiveQuery(db.select().from(referenceCategories));
  const { data: budgets } = useLiveQuery(db.select().from(referenceBudgets));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const assetAccounts = (accountRows ?? []).filter((a) => a.type === 'asset');

  const [type, setType] = useState<Draft['type']>('withdrawal');
  const [amount, setAmount] = useState('0');
  const [currencyCode, setCurrencyCode] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date());
  const [dateMode, setDateMode] = useState<'today' | 'yesterday' | 'custom'>('today');
  const [merchantRawInput, setMerchantRawInput] = useState('');
  const [forceNewPayee, setForceNewPayee] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [sharedWith, setSharedWith] = useState('');
  const [foreignAmount, setForeignAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  const [payeeSheetOpen, setPayeeSheetOpen] = useState(false);
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);

  const [histories, setHistories] = useState<MerchantHistory[]>([]);
  useEffect(() => { buildMerchantLookup(db).then((map) => setHistories([...map.values()])); }, [db]);

  // Defaults arrive asynchronously (SecureStore/app_settings) after first render — derived here
  // rather than mirrored into state via an effect, so there is nothing to keep in sync.
  const isPayeeType = type === 'withdrawal' || type === 'deposit';
  const effectiveCurrencyCode = currencyCode ?? defaultCurrencyCode;
  const effectiveSourceId = sourceId ?? (type === 'withdrawal' || type === 'transfer' ? defaultAccountId : null);

  const [matchedFor, setMatchedFor] = useState<{ text: string; caption: string | null } | null>(null);
  useEffect(() => {
    if (!isPayeeType || !merchantRawInput.trim()) return;
    let cancelled = false;
    matchAlias(db, 'payee', merchantRawInput).then((match) => {
      if (cancelled) return;
      const caption = match.matched && match.alias.targetName !== merchantRawInput ? `matched "${merchantRawInput}" → ${match.alias.targetName}` : null;
      setMatchedFor({ text: merchantRawInput, caption });
    });
    return () => { cancelled = true; };
  }, [db, isPayeeType, merchantRawInput]);
  const aliasCaption = isPayeeType && matchedFor?.text === merchantRawInput ? matchedFor.caption : null;

  const rankedPayees = useMemo(() => rankCandidates(histories, {}).slice(0, 6)
    .map((c) => histories.find((h) => h.merchantKey === c.merchantKey))
    .filter((h): h is MerchantHistory => !!h), [histories]);

  const sourceAccount = assetAccounts.find((a) => a.id === effectiveSourceId);
  const destinationAccount = assetAccounts.find((a) => a.id === destinationId);
  const budget = (budgets ?? []).find((b) => b.id === budgetId);

  // FX (design §6.2): reveal when the account leg's currency differs from the chosen currency.
  const accountCurrencyCode = type === 'deposit' ? destinationAccount?.currencyCode : sourceAccount?.currencyCode;
  const showFx = !!accountCurrencyCode && !!effectiveCurrencyCode && accountCurrencyCode !== effectiveCurrencyCode;
  const impliedRate = showFx && foreignAmount && amount !== '0'
    ? divideDecimal(foreignAmount, amount, 2)
    : null;

  const formState: CaptureFormState = {
    type, amount, currencyCode: effectiveCurrencyCode ?? '', date,
    description, merchantRawInput, forceNewPayee,
    sourceId: effectiveSourceId, destinationId, categoryName, budgetId,
    notes, sharedWith,
    foreignAmount: showFx ? foreignAmount : '',
    foreignCurrencyCode: showFx ? accountCurrencyCode ?? null : null,
  };

  const previewDraft: Draft = {
    type, amount, currencyCode: effectiveCurrencyCode ?? '', date: date.toISOString(),
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

  const isDirty = amount !== '0';

  const confirmClose = useCallback(() => {
    if (!isDirty) {
      router.back();
      return;
    }
    Alert.alert('Discard this entry?', undefined, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  }, [isDirty]);

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
    DateTimePickerAndroid.open({
      value: date,
      mode: 'date',
      onChange: (event: { type: string }, picked?: Date) => {
        if (event.type === 'set' && picked) {
          setDate(buildEntryDate(picked, new Date()));
          setDateMode('custom');
        }
      },
    });
  }

  async function handleSave(andConfirm: boolean) {
    if (saving) return;
    if (andConfirm && !readiness.ready) {
      haptics.warn();
      return;
    }
    setSaving(true);
    try {
      const input = buildManualEntryInput(formState, assetAccounts);
      const { inboxItemId } = await createManualEntry(db, input);
      if (andConfirm) await confirmInboxItem(db, inboxItemId);
      haptics.tick();
      setToast(`Saved · ${merchantRawInput || description || labelForType(type)}`);
      setAmount('0');
      setForeignAmount('');
    } finally {
      setSaving(false);
    }
  }

  const currency = currencyOf(currencies ?? [], effectiveCurrencyCode ?? '');
  const summaryParts = [merchantRawInput, categoryName].filter(Boolean);

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingHorizontal: t.space.lg, paddingTop: t.space.sm }}>
          <Pressable onPress={confirmClose} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={[t.type.heading, { color: t.color.text }]}>✕</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', flex: 1, gap: t.space.xs }}>
            {TYPES.map((option) => (
              <Chip key={option.type} label={option.label} selected={type === option.type} onPress={() => setType(option.type)} />
            ))}
          </View>
          <Pressable onPress={() => setCurrencySheetOpen(true)} accessibilityRole="button">
            <Text style={[t.type.heading, { color: t.color.text }]}>{effectiveCurrencyCode ?? '—'} ▾</Text>
          </Pressable>
        </View>

        <View style={{ alignItems: 'center', paddingVertical: t.space.xl }}>
          <Money amount={amount} currency={currency} size="display" />
          {summaryParts.length > 0 && (
            <Text style={[t.type.body, { color: t.color.textMuted, marginTop: t.space.xs }]}>{summaryParts.join(' · ')}</Text>
          )}
          {!!aliasCaption && (
            <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>{aliasCaption}</Text>
          )}
        </View>

        {showFx && (
          <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              + {amount} {effectiveCurrencyCode} → converts to
            </Text>
            <TextInput
              value={foreignAmount}
              onChangeText={setForeignAmount}
              keyboardType="decimal-pad"
              placeholder={`___ ${accountCurrencyCode}`}
              placeholderTextColor={t.color.textFaint}
              style={{
                borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm,
                paddingHorizontal: t.space.md, paddingVertical: t.space.sm, color: t.color.text, marginTop: t.space.xs,
              }}
            />
            {!!impliedRate && !isNegative(impliedRate) && (
              <Text style={[t.type.label, { color: t.color.textFaint, marginTop: t.space.xs }]}>
                1 {effectiveCurrencyCode} ≈ {impliedRate} {accountCurrencyCode}
              </Text>
            )}
          </View>
        )}

        <View style={{ gap: t.space.sm }}>
          {isPayeeType && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: t.space.lg, gap: t.space.sm }}>
              {rankedPayees.map((h) => (
                <Chip key={h.merchantKey} label={h.displayName} selected={merchantRawInput === h.displayName} onPress={() => applyPayeeHistory(h)} />
              ))}
              <Chip label="🔍" onPress={() => setPayeeSheetOpen(true)} />
            </ScrollView>
          )}

          {type === 'transfer' ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: t.space.lg, gap: t.space.sm }}>
                {assetAccounts.map((a) => (
                  <Chip key={a.id} label={`From ${a.name}`} selected={effectiveSourceId === a.id} onPress={() => setSourceId(a.id)} />
                ))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: t.space.lg, gap: t.space.sm }}>
                {assetAccounts.map((a) => (
                  <Chip key={a.id} label={`To ${a.name}`} selected={destinationId === a.id} onPress={() => setDestinationId(a.id)} />
                ))}
                <Chip label="⋯ More" onPress={() => setMoreSheetOpen(true)} />
              </ScrollView>
            </>
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: t.space.lg, gap: t.space.sm }}>
                {assetAccounts.map((a) => (
                  <Chip
                    key={a.id}
                    label={a.name}
                    selected={(type === 'withdrawal' ? effectiveSourceId : destinationId) === a.id}
                    onPress={() => (type === 'withdrawal' ? setSourceId(a.id) : setDestinationId(a.id))}
                  />
                ))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: t.space.lg, gap: t.space.sm }}>
                <Chip
                  label={categoryName ?? 'Category'}
                  selected={!!categoryName}
                  dotColor={categoryName ? categoryColor(categoryName, t.dark) : undefined}
                  onPress={() => setCategorySheetOpen(true)}
                />
                <Chip label={budget?.name ?? 'Budget'} selected={!!budgetId} onPress={() => setBudgetSheetOpen(true)} />
                {!!description && <Chip label={description} onPress={() => setMoreSheetOpen(true)} />}
                {!!notes && <Chip label={notes} onPress={() => setMoreSheetOpen(true)} />}
                {!!sharedWith && <Chip label={`Shared with ${sharedWith}`} onPress={() => setMoreSheetOpen(true)} />}
                <Chip label="⋯ More" onPress={() => setMoreSheetOpen(true)} />
              </ScrollView>
            </>
          )}
        </View>

        <View style={{ flex: 1 }} />

        <Keypad
          onDigit={(key: KeypadKey) => setAmount((cur) => applyDigit(cur, key, currency.decimalPlaces))}
          dateLabel={dateMode === 'today' ? 'Today ▾' : dateMode === 'yesterday' ? 'Yesterday ▾' : date.toLocaleDateString()}
          onDatePress={() => setDateSheetOpen(true)}
          onNotePress={() => setMoreSheetOpen(true)}
          noteHasValue={!!notes}
          saveLabel="Save & ✓"
          onSave={() => handleSave(true)}
          saveDisabled={!readiness.ready}
          saving={saving}
        />
        <Pressable onPress={() => handleSave(false)} disabled={saving} style={{ alignItems: 'center', paddingVertical: t.space.md }}>
          <Text style={[t.type.body, { color: t.color.accent, fontWeight: '600', opacity: saving ? 0.4 : 1 }]}>Save to inbox</Text>
        </Pressable>

        {!!toast && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', top: 8, left: t.space.lg, right: t.space.lg, alignItems: 'center',
            }}
          >
            <View style={{ backgroundColor: t.color.text, borderRadius: t.radius.pill, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm }}>
              <Text style={[t.type.label, { color: t.color.surface }]}>{toast}</Text>
            </View>
          </View>
        )}
      </View>

      <Sheet visible={dateSheetOpen} onClose={() => setDateSheetOpen(false)} title="Date">
        <View style={{ gap: t.space.sm }}>
          <Button title="Today" variant={dateMode === 'today' ? 'primary' : 'secondary'} onPress={() => pickDate('today')} />
          <Button title="Yesterday" variant={dateMode === 'yesterday' ? 'primary' : 'secondary'} onPress={() => pickDate('yesterday')} />
          <Button title="Pick a date…" variant="secondary" onPress={openNativeDatePicker} />
        </View>
      </Sheet>

      <Sheet visible={currencySheetOpen} onClose={() => setCurrencySheetOpen(false)} title="Currency">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {(currencies ?? []).map((c) => (
            <Chip key={c.code} label={c.code} selected={c.code === effectiveCurrencyCode} onPress={() => { setCurrencyCode(c.code); setCurrencySheetOpen(false); }} />
          ))}
        </View>
      </Sheet>

      <Sheet visible={categorySheetOpen} onClose={() => setCategorySheetOpen(false)} title="Category">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          <Chip label="None" selected={!categoryName} onPress={() => { setCategoryName(null); setCategorySheetOpen(false); }} />
          {(categories ?? []).map((c) => (
            <Chip key={c.id} label={c.name} selected={c.name === categoryName} onPress={() => { setCategoryName(c.name); setCategorySheetOpen(false); }} />
          ))}
        </View>
      </Sheet>

      <Sheet visible={budgetSheetOpen} onClose={() => setBudgetSheetOpen(false)} title="Budget">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          <Chip label="None" selected={!budgetId} onPress={() => { setBudgetId(null); setBudgetSheetOpen(false); }} />
          {(budgets ?? []).map((b) => (
            <Chip key={b.id} label={b.name} selected={b.id === budgetId} onPress={() => { setBudgetId(b.id); setBudgetSheetOpen(false); }} />
          ))}
        </View>
      </Sheet>

      <PayeeSheet
        visible={payeeSheetOpen}
        onClose={() => setPayeeSheetOpen(false)}
        histories={histories}
        payeeLabel={type === 'deposit' ? 'payer' : 'payee'}
        onSelect={applyPayeeHistory}
        onCreateNew={(text) => { setMerchantRawInput(text); setForceNewPayee(true); }}
      />

      <Sheet
        visible={moreSheetOpen}
        onClose={() => setMoreSheetOpen(false)}
        title="More"
        footer={<Button title="Done" onPress={() => setMoreSheetOpen(false)} />}
      >
        <TextInput
          placeholder="Description" value={description} onChangeText={setDescription}
          placeholderTextColor={t.color.textFaint}
          style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text }}
        />
        <TextInput
          placeholder="Notes" value={notes} onChangeText={setNotes}
          placeholderTextColor={t.color.textFaint}
          style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text }}
        />
        <TextInput
          placeholder="Shared with" value={sharedWith} onChangeText={setSharedWith}
          placeholderTextColor={t.color.textFaint}
          style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text }}
        />
      </Sheet>
    </Screen>
  );
}
