// Transaction detail (design §6.5) — the same editing vocabulary as the draft screen: hero
// amount + DetailRows, one picker implementation for both.
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, Card, Button, Money, Row, Sheet } from '../../src/ui/components';
import { DetailRows, type DetailRowsValue } from '../../src/ui/DetailRows';
import { Keypad } from '../../src/ui/Keypad';
import { currencyOf } from '../../src/ui/money';
import { relativeTime } from '../../src/ui/relativeTime';
import { applyDigit, type KeypadKey } from '../../src/capture/amountInput';
import { buildEntryDate } from '../../src/capture/entryDate';
import { cachedTransactions, outboxOperations, referenceAccounts, referenceCategories, referenceBudgets, referenceCurrencies } from '../../src/db/schema';
import { enqueueOperation, type UpdateTransactionPayload, type DeleteTransactionPayload } from '../../src/sync/outbox';
import { generateId } from '../../src/utils/id';
import type { TransactionSplit } from '../../src/api/ff3/types';

const SHARED_TAG_PREFIX = 'mmyway-shared-';

function sharedWithFromTags(tagsJson: string): string | null {
  try {
    const tags: string[] = JSON.parse(tagsJson);
    const match = tags.find((tag) => tag.startsWith(SHARED_TAG_PREFIX));
    return match ? match.slice(SHARED_TAG_PREFIX.length) : null;
  } catch {
    return null;
  }
}

export default function TransactionDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const db = useDb();
  const t = useTheme();

  const { data: rows } = useLiveQuery(db.select().from(cachedTransactions).where(eq(cachedTransactions.groupId, groupId)));
  const { data: outbox } = useLiveQuery(db.select().from(outboxOperations));
  const { data: accountRows } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: categories } = useLiveQuery(db.select().from(referenceCategories));
  const { data: budgets } = useLiveQuery(db.select().from(referenceBudgets));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const assetAccounts = (accountRows ?? []).filter((a) => a.type === 'asset');
  const row = rows?.[0];

  const [changes, setChanges] = useState<Partial<TransactionSplit>>({});
  const [amountSheetOpen, setAmountSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!row) return <Screen bottom><AppBar title="Transaction" /></Screen>;

  const conflictOp = (outbox ?? []).find((op) => {
    if (op.status !== 'failed' || op.lastError !== 'conflict') return false;
    if (op.kind !== 'update_transaction' && op.kind !== 'delete_transaction') return false;
    return JSON.parse(op.payloadJson).groupId === groupId;
  });

  const currency = currencyOf(currencies ?? [], row.currencyCode);
  const effectiveAmount = changes.amount ?? row.amount;
  const effectiveSourceId = changes.source_id ?? assetAccounts.find((a) => a.name === row.sourceName)?.id ?? null;
  const effectiveDestinationId = changes.destination_id ?? assetAccounts.find((a) => a.name === row.destinationName)?.id ?? null;
  const effectiveBudgetId = changes.budget_id ?? (budgets ?? []).find((b) => b.name === row.budgetName)?.id ?? null;
  const effectiveCategoryName = changes.category_name ?? row.categoryName ?? null;
  const effectiveDate = changes.date ? new Date(changes.date) : new Date(row.date);
  const effectiveNotes = changes.notes ?? row.notes ?? null;
  const effectiveSharedWith = changes.tags
    ? changes.tags.find((tag) => tag.startsWith(SHARED_TAG_PREFIX))?.slice(SHARED_TAG_PREFIX.length) ?? null
    : sharedWithFromTags(row.tagsJson);

  function handleDetailChange(change: Partial<DetailRowsValue>) {
    setChanges((prev) => {
      const next = { ...prev };
      if ('categoryName' in change) next.category_name = change.categoryName ?? undefined;
      if ('sourceAccountId' in change) next.source_id = change.sourceAccountId ?? undefined;
      if ('destinationAccountId' in change) next.destination_id = change.destinationAccountId ?? undefined;
      if ('budgetId' in change) next.budget_id = change.budgetId ?? undefined;
      if ('notes' in change) next.notes = change.notes ?? undefined;
      if ('sharedWith' in change) {
        let existingTags: string[] = [];
        try { existingTags = JSON.parse(row!.tagsJson); } catch { existingTags = []; }
        const withoutShared = existingTags.filter((tag) => !tag.startsWith(SHARED_TAG_PREFIX));
        next.tags = change.sharedWith ? [...withoutShared, `${SHARED_TAG_PREFIX}${change.sharedWith}`] : withoutShared;
      }
      return next;
    });
  }

  function openDatePicker() {
    DateTimePickerAndroid.open({
      value: effectiveDate,
      mode: 'date',
      onChange: (event: { type: string }, picked?: Date) => {
        if (event.type === 'set' && picked) {
          setChanges((prev) => ({ ...prev, date: buildEntryDate(picked, effectiveDate).toISOString() }));
        }
      },
    });
  }

  async function keepMine() {
    if (!conflictOp) return;
    const payload = JSON.parse(conflictOp.payloadJson) as UpdateTransactionPayload | DeleteTransactionPayload;
    payload.expectedUpdatedAt = row!.updatedAt;
    await db.update(outboxOperations).set({ status: 'pending', payloadJson: JSON.stringify(payload), lastError: null }).where(eq(outboxOperations.id, conflictOp.id));
  }
  async function discardMine() {
    if (!conflictOp) return;
    await db.delete(outboxOperations).where(eq(outboxOperations.id, conflictOp.id));
  }

  async function onSave() {
    if (Object.keys(changes).length === 0) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      await enqueueOperation(db, {
        id: generateId(),
        kind: 'update_transaction',
        payload: { groupId: row!.groupId, transactionJournalId: row!.journalId, expectedUpdatedAt: row!.updatedAt, changes },
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  function onDelete() {
    setMenuOpen(false);
    Alert.alert('Delete this transaction?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await enqueueOperation(db, { id: generateId(), kind: 'delete_transaction', payload: { groupId: row!.groupId, expectedUpdatedAt: row!.updatedAt } });
          router.back();
        },
      },
    ]);
  }

  if (conflictOp) {
    const pending = JSON.parse(conflictOp.payloadJson) as UpdateTransactionPayload;
    return (
      <Screen bottom>
        <AppBar title="Conflict" left={<CloseButton />} />
        <View style={{ padding: t.space.lg, gap: t.space.md }}>
          <Card>
            <Text style={[t.type.heading, { color: t.color.text }]}>On the server</Text>
            <Money amount={row.amount} currency={currency} type={row.type as 'withdrawal' | 'deposit' | 'transfer'} size="heading" />
            <Text style={[t.type.body, { color: t.color.textMuted }]}>{row.description}</Text>
          </Card>
          <Card>
            <Text style={[t.type.heading, { color: t.color.text }]}>Your queued change</Text>
            {conflictOp.kind === 'delete_transaction' ? (
              <Text style={[t.type.body, { color: t.color.danger }]}>Delete this transaction</Text>
            ) : (
              Object.entries(pending.changes ?? {}).map(([key, value]) => (
                <Text key={key} style={[t.type.body, { color: t.color.textMuted }]}>{key}: {JSON.stringify(value)}</Text>
              ))
            )}
          </Card>
          <Button title="Keep mine (retry against the new version)" onPress={keepMine} />
          <Button title="Use the server's" variant="danger" onPress={discardMine} />
        </View>
      </Screen>
    );
  }

  const detailValue: DetailRowsValue = {
    type: row.type as 'withdrawal' | 'deposit' | 'transfer',
    categoryName: effectiveCategoryName,
    sourceAccountId: effectiveSourceId,
    destinationAccountId: effectiveDestinationId,
    budgetId: effectiveBudgetId,
    dateLabel: effectiveDate.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    notes: effectiveNotes,
    sharedWith: effectiveSharedWith,
  };

  return (
    <Screen bottom>
      <View style={{ flex: 1 }}>
        <AppBar
          title={row.type[0]!.toUpperCase() + row.type.slice(1)}
          subtitle={`synced ${relativeTime(row.syncedAt)}`}
          left={<CloseButton />}
          right={(
            <Pressable onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="More">
              <Text style={[t.type.heading, { color: t.color.text }]}>⋯</Text>
            </Pressable>
          )}
        />

        <View style={{ alignItems: 'center', paddingVertical: t.space.lg }}>
          <Pressable onPress={() => setAmountSheetOpen(true)}>
            <Money amount={effectiveAmount} currency={currency} type={row.type as 'withdrawal' | 'deposit' | 'transfer'} size="title" />
          </Pressable>
          <Text style={[t.type.heading, { color: t.color.text, marginTop: t.space.xs }]}>{row.description}</Text>
        </View>

        <View style={{ gap: t.space.md }}>
          <DetailRows
            value={detailValue}
            onChange={handleDetailChange}
            onDatePress={openDatePicker}
            accounts={assetAccounts}
            categories={categories ?? []}
            budgets={budgets ?? []}
          />
          <Card style={{ marginHorizontal: t.space.lg }}>
            <Row first label="Receipt" value="Attach receipt" chevron onPress={() => router.push({ pathname: '/receipt', params: { attachToJournalId: row.journalId } })} />
          </Card>
        </View>

        <View style={{ padding: t.space.lg }}>
          <Button title={saving ? 'Saving…' : 'Save'} onPress={onSave} disabled={saving} size="lg" />
        </View>
      </View>

      <Sheet visible={amountSheetOpen} onClose={() => setAmountSheetOpen(false)} title="Amount">
        <Money amount={effectiveAmount} currency={currency} type={row.type as 'withdrawal' | 'deposit' | 'transfer'} size="display" />
        <Keypad
          compact
          onDigit={(key: KeypadKey) => setChanges((prev) => ({ ...prev, amount: applyDigit(prev.amount ?? row.amount, key, currency.decimalPlaces) }))}
          saveLabel="Done"
          onSave={() => setAmountSheetOpen(false)}
        />
      </Sheet>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Transaction">
        <Row first label="Delete" tone="danger" onPress={onDelete} />
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
