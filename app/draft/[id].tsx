// Draft review (design §6.3) — one legible card for both a manual draft and a receipt.
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, Card, Chip, Button, Money, StatusPill, Sheet, Row } from '../../src/ui/components';
import { DetailRows, type DetailRowsValue } from '../../src/ui/DetailRows';
import { PayeeSheet } from '../../src/ui/PayeeSheet';
import { Keypad } from '../../src/ui/Keypad';
import { currencyOf } from '../../src/ui/money';
import { haptics } from '../../src/ui/haptics';
import { inboxItems, referenceAccounts, referenceCategories, referenceBudgets, referenceCurrencies } from '../../src/db/schema';
import { confirmInboxItem } from '../../src/inbox/createManualEntry';
import { updateDraft, deleteInboxItem } from '../../src/inbox/updateDraft';
import { draftReadiness } from '../../src/inbox/readiness';
import { applyDigit, type KeypadKey } from '../../src/capture/amountInput';
import { buildEntryDate } from '../../src/capture/entryDate';
import { buildMerchantLookup, type MerchantHistory } from '../../src/lookup/merchantLookup';
import { matchAlias } from '../../src/lookup/aliases';
import type { Draft } from '../../src/inbox/draft';

export default function DraftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const t = useTheme();

  const { data: rows } = useLiveQuery(db.select().from(inboxItems).where(eq(inboxItems.id, id)));
  const { data: accountRows } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: categories } = useLiveQuery(db.select().from(referenceCategories));
  const { data: budgets } = useLiveQuery(db.select().from(referenceBudgets));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const assetAccounts = (accountRows ?? []).filter((a) => a.type === 'asset');

  const [histories, setHistories] = useState<MerchantHistory[]>([]);
  useEffect(() => { buildMerchantLookup(db).then((map) => setHistories([...map.values()])); }, [db]);

  const [amountSheetOpen, setAmountSheetOpen] = useState(false);
  const [payeeSheetOpen, setPayeeSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [matchedFor, setMatchedFor] = useState<{ text: string; caption: string | null } | null>(null);

  const row = rows?.[0];
  const draft: Draft | null = row ? JSON.parse(row.draftJson) : null;
  const readOnly = row ? row.state === 'confirmed' || row.state === 'synced' : false;
  const payeeName = draft ? (draft.type === 'deposit' ? draft.sourceName : draft.destinationName) : undefined;
  const isPayeeType = !!draft && draft.type !== 'transfer';

  useEffect(() => {
    if (!isPayeeType || !payeeName?.trim()) return;
    let cancelled = false;
    matchAlias(db, 'payee', payeeName).then((match) => {
      if (cancelled) return;
      const caption = match.matched && match.alias.targetName !== payeeName ? `matched "${payeeName}" → ${match.alias.targetName}` : null;
      setMatchedFor({ text: payeeName, caption });
    });
    return () => { cancelled = true; };
  }, [db, isPayeeType, payeeName]);
  const aliasCaption = isPayeeType && matchedFor && matchedFor.text === payeeName ? matchedFor.caption : null;

  if (!row || !draft) {
    return (
      <Screen bottom>
        <AppBar title="Review" left={<CloseButton />} />
      </Screen>
    );
  }

  const currency = currencyOf(currencies ?? [], draft.currencyCode);
  const readiness = draftReadiness(draft);

  function patch(fields: Partial<Draft>) {
    updateDraft(db, id, fields);
  }

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

  function openDatePicker() {
    DateTimePickerAndroid.open({
      value: new Date(draft!.date),
      mode: 'date',
      onChange: (event: { type: string }, picked?: Date) => {
        if (event.type === 'set' && picked) patch({ date: buildEntryDate(picked, new Date(draft!.date)).toISOString() });
      },
    });
  }

  async function handleConfirm() {
    if (confirming || !readiness.ready) {
      if (!readiness.ready) haptics.warn();
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
  }

  function handleDeleteDraft() {
    setMenuOpen(false);
    Alert.alert('Delete this draft?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteInboxItem(db, id); router.back(); } },
    ]);
  }

  const detailValue: DetailRowsValue = {
    type: draft.type,
    categoryName: draft.categoryName ?? null,
    sourceAccountId: draft.sourceId ?? null,
    destinationAccountId: draft.destinationId ?? null,
    budgetId: draft.budgetId ?? null,
    dateLabel: new Date(draft.date).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    notes: draft.notes ?? null,
    sharedWith: draft.sharedWith ?? null,
  };

  const itemCount = row.kind === 'receipt' && draft.notes ? draft.notes.split('\n').filter(Boolean).length : 0;

  return (
    <Screen bottom>
      <View style={{ flex: 1 }}>
        <AppBar
          title="Review"
          left={<CloseButton />}
          right={(
            <Pressable onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="More">
              <Text style={[t.type.heading, { color: t.color.text }]}>⋯</Text>
            </Pressable>
          )}
        />

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
              <Chip label="⚑ New payee — will be created in FF3" tone="warn" />
            </View>
          )}
        </View>

        <View style={{ gap: t.space.md, flex: 1 }}>
          <DetailRows
            value={detailValue}
            onChange={handleDetailChange}
            onDatePress={openDatePicker}
            readOnly={readOnly}
            accounts={assetAccounts}
            categories={categories ?? []}
            budgets={budgets ?? []}
          />

          {row.kind === 'receipt' && (
            <Card style={{ marginHorizontal: t.space.lg, flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
              {!!row.receiptImagePath && (
                <Image source={{ uri: row.receiptImagePath }} style={{ width: 44, height: 44, borderRadius: t.radius.sm }} />
              )}
              <Text style={[t.type.body, { color: t.color.textMuted }]}>
                {itemCount > 0 ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Receipt'}
              </Text>
            </Card>
          )}
        </View>

        {readOnly ? (
          <View style={{ alignItems: 'center', padding: t.space.lg }}>
            <StatusPill state={row.state === 'synced' ? 'ok' : 'queued'} label={row.state === 'synced' ? 'Synced' : 'Queued'} />
          </View>
        ) : (
          <View style={{ padding: t.space.lg, gap: t.space.sm }}>
            {readiness.missing.length > 0 && (
              <Text style={[t.type.label, { color: t.color.warn, textAlign: 'center' }]}>Missing: {readiness.missing.join(', ')}</Text>
            )}
            <Button title={confirming ? 'Confirming…' : 'Confirm'} onPress={handleConfirm} disabled={confirming || !readiness.ready} size="lg" />
          </View>
        )}
      </View>

      <Sheet visible={amountSheetOpen} onClose={() => setAmountSheetOpen(false)} title="Amount">
        <Money amount={draft.amount} currency={currency} type={draft.type} size="display" />
        <Keypad
          compact
          onDigit={(key: KeypadKey) => patch({ amount: applyDigit(draft.amount, key, currency.decimalPlaces) })}
          saveLabel="Done"
          onSave={() => setAmountSheetOpen(false)}
        />
      </Sheet>

      <PayeeSheet
        visible={payeeSheetOpen}
        onClose={() => setPayeeSheetOpen(false)}
        histories={histories}
        payeeLabel={draft.type === 'deposit' ? 'payer' : 'payee'}
        onSelect={(h) => {
          patch(draft.type === 'deposit' ? { sourceName: h.displayName, isNewPayee: false } : { destinationName: h.displayName, isNewPayee: false });
        }}
        onCreateNew={(text) => {
          patch(draft.type === 'deposit' ? { sourceName: text, isNewPayee: true } : { destinationName: text, isNewPayee: true });
        }}
      />

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Draft">
        {readOnly && !!row.ff3GroupId && (
          <Row
            first
            label="Open in Activity"
            chevron
            onPress={() => { setMenuOpen(false); router.push(`/transactions/${row.ff3GroupId}`); }}
          />
        )}
        <Row first={!readOnly || !row.ff3GroupId} label="Delete draft" tone="danger" onPress={handleDeleteDraft} />
      </Sheet>
    </Screen>
  );
}

function CloseButton() {
  const t = useTheme();
  return (
    <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close">
      <Text style={[t.type.heading, { color: t.color.text }]}>✕</Text>
    </Pressable>
  );
}
