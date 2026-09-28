// Draft review (design §6.3) — one legible card for both a manual draft and a receipt.
import { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, BarIconButton, Card, Chip, Button, Money, StatusPill, Sheet, Row } from '../../src/ui/components';
import { DetailRows, type DetailRowsValue } from '../../src/ui/DetailRows';
import { PayeeSheet } from '../../src/ui/PayeeSheet';
import { Keypad } from '../../src/ui/Keypad';
import { currencyOf } from '../../src/ui/money';
import { haptics } from '../../src/ui/haptics';
import { inboxItems, outboxOperations, referenceCategories, referenceBudgets, referenceCurrencies } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import { confirmInboxItem, undoConfirm } from '../../src/inbox/createManualEntry';
import { askPhotoSource, pickPhoto } from '../../src/receipt/pickPhoto';
import { persistReceiptImage } from '../../src/receipt/imageFiles';
import { updateDraft, deleteInboxItem } from '../../src/inbox/updateDraft';
import { draftReadiness } from '../../src/inbox/readiness';
import { applyDigit, type KeypadKey } from '../../src/capture/amountInput';
import { buildEntryDate } from '../../src/capture/entryDate';
import { buildMerchantLookup, type MerchantHistory } from '../../src/lookup/merchantLookup';
import { matchAlias } from '../../src/lookup/aliases';
import type { Draft } from '../../src/inbox/draft';
import { navigateOnce } from '../../src/ui/navigateOnce';

export default function DraftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const t = useTheme();

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
  async function attachPhoto() {
    const source = await askPhotoSource();
    if (!source) return;
    const photo = await pickPhoto(source);
    if (!photo) return;
    await db.update(inboxItems).set({ receiptImagePath: persistReceiptImage(photo.uri), updatedAt: new Date().toISOString() }).where(eq(inboxItems.id, id));
  }
  async function cancelSending() {
    if (!pendingCreate) return;
    // A receipt goes back to `parsed`: as `captured` the next sync would re-read the photo
    // and overwrite the reviewed draft.
    const outcome = await undoConfirm(db, id, { outboxOperationId: pendingCreate.id, previousState: row?.kind === 'receipt' ? 'parsed' : 'captured' });
    if (outcome === 'already_sent') Alert.alert('Already sent', 'It reached Firefly III before it could be cancelled.');
  }
  const draft: Draft | null = row ? JSON.parse(row.draftJson) : null;

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
  const [matchedFor, setMatchedFor] = useState<{ text: string; caption: string | null } | null>(null);

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
            <BarIconButton icon="ellipsis-horizontal" label="More" onPress={() => setMenuOpen(true)} />
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

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: t.space.md, paddingBottom: t.space.lg }}>
          {!!row.errorMessage && !readOnly && (
            <View style={{ marginHorizontal: t.space.lg, padding: t.space.md, borderRadius: t.radius.sm, backgroundColor: t.color.warnSoft }}>
              <Text style={[t.type.label, { color: t.color.warn }]}>{row.errorMessage}</Text>
            </View>
          )}
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

          {row.kind !== 'receipt' && !row.receiptImagePath && row.state !== 'synced' && (
            <Card style={{ marginHorizontal: t.space.lg }}>
              <Row first label="Receipt photo" value="Attach" chevron onPress={attachPhoto} />
            </Card>
          )}
          {(row.kind === 'receipt' || !!row.receiptImagePath) && (
            <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
              {row.receiptImagePath ? (
                <Pressable onPress={() => setPhotoOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="Show the receipt photo">
                  <Image source={{ uri: row.receiptImagePath }} resizeMode="cover" style={{ width: '100%', height: 140, borderRadius: t.radius.sm, backgroundColor: t.color.surfaceAlt }} />
                </Pressable>
              ) : (
                <Text style={[t.type.label, { color: t.color.textFaint }]}>The photo is in Firefly III (no copy kept on this phone).</Text>
              )}
              <Text style={[t.type.body, { color: t.color.textMuted }]}>
                {itemCount > 0 ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Receipt'}
              </Text>
            </Card>
          )}
        </ScrollView>

        {readOnly ? (
          <View style={{ alignItems: 'center', padding: t.space.lg, gap: t.space.md }}>
            <StatusPill state={row.state === 'synced' ? 'ok' : 'queued'} label={row.state === 'synced' ? 'Synced' : 'Queued'} />
            {!!pendingCreate && (
              <Button title="Cancel sending" variant="secondary" onPress={cancelSending} />
            )}
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
            onPress={() => { setMenuOpen(false); navigateOnce(`/transactions/${row.ff3GroupId}`); }}
          />
        )}
        <Row first={!readOnly || !row.ff3GroupId} label="Delete draft" tone="danger" onPress={handleDeleteDraft} />
      </Sheet>
      <Modal visible={photoOpen && !!row.receiptImagePath} transparent animationType="fade" onRequestClose={() => setPhotoOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: t.color.photoBackdrop, justifyContent: 'center' }} onPress={() => setPhotoOpen(false)} accessibilityLabel="Close the photo">
          {!!row.receiptImagePath && <Image source={{ uri: row.receiptImagePath }} resizeMode="contain" style={{ width: '100%', height: '100%' }} />}
        </Pressable>
      </Modal>
    </Screen>
  );
}

function CloseButton() {
  return <BarIconButton icon="close" label="Close" onPress={() => router.back()} />;
}
