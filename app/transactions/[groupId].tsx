import { useState } from 'react';
import { View, Text, TextInput, Button, ScrollView } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useDb } from '../../src/providers/DbProvider';
import { cachedTransactions, outboxOperations, referenceAccounts, referenceCategories, referenceBudgets } from '../../src/db/schema';
import { enqueueOperation, type UpdateTransactionPayload, type DeleteTransactionPayload } from '../../src/sync/outbox';
import { generateId } from '../../src/utils/id';

function Picker({ label, items, selectedId, onSelect }: { label: string; items: { id: string; name: string }[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontWeight: 'bold' }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {items.map((item) => (
          <Text
            key={item.id}
            onPress={() => onSelect(item.id)}
            style={{ padding: 6, borderWidth: 1, borderColor: item.id === selectedId ? '#000' : '#ccc', fontWeight: item.id === selectedId ? 'bold' : 'normal' }}
          >
            {item.name}
          </Text>
        ))}
      </View>
    </View>
  );
}

export default function TransactionDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const db = useDb();
  const { data: rows } = useLiveQuery(db.select().from(cachedTransactions).where(eq(cachedTransactions.groupId, groupId)));
  const { data: outbox } = useLiveQuery(db.select().from(outboxOperations));
  const { data: accounts } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: categories } = useLiveQuery(db.select().from(referenceCategories));
  const { data: budgets } = useLiveQuery(db.select().from(referenceBudgets));
  const assetAccounts = (accounts ?? []).filter((a) => a.type === 'asset');
  const row = rows?.[0];

  const [amount, setAmount] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);

  if (!row) return <Text>Loading…</Text>;

  const conflictOp = (outbox ?? []).find((op) => {
    if (op.status !== 'failed' || op.lastError !== 'conflict') return false;
    if (op.kind !== 'update_transaction' && op.kind !== 'delete_transaction') return false;
    return JSON.parse(op.payloadJson).groupId === groupId;
  });

  async function keepMine() {
    if (!conflictOp) return;
    const payload = JSON.parse(conflictOp.payloadJson) as UpdateTransactionPayload | DeleteTransactionPayload;
    payload.expectedUpdatedAt = row!.updatedAt; // re-arm against the server's current version
    await db.update(outboxOperations).set({ status: 'pending', payloadJson: JSON.stringify(payload), lastError: null }).where(eq(outboxOperations.id, conflictOp.id));
  }

  async function discardMine() {
    if (!conflictOp) return;
    await db.delete(outboxOperations).where(eq(outboxOperations.id, conflictOp.id));
  }

  async function onSave() {
    const changes: UpdateTransactionPayload['changes'] = {};
    if (amount !== null) changes.amount = amount;
    if (categoryName !== null) changes.category_name = categoryName;
    if (budgetId !== null) changes.budget_id = budgetId;
    if (notes !== null) changes.notes = notes;
    if (sourceId !== null) changes.source_id = sourceId;
    if (Object.keys(changes).length === 0) return;

    await enqueueOperation(db, {
      id: generateId(),
      kind: 'update_transaction',
      payload: { groupId: row!.groupId, transactionJournalId: row!.journalId, expectedUpdatedAt: row!.updatedAt, changes },
    });
    router.back();
  }

  async function onDelete() {
    await enqueueOperation(db, {
      id: generateId(),
      kind: 'delete_transaction',
      payload: { groupId: row!.groupId, expectedUpdatedAt: row!.updatedAt },
    });
    router.back();
  }

  if (conflictOp) {
    const pending = JSON.parse(conflictOp.payloadJson);
    return (
      <View style={{ flex: 1, padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: 'bold' }}>Conflict — this transaction changed on the server</Text>
        <Text style={{ fontWeight: 'bold' }}>Server version</Text>
        <Text>{row.amount} {row.currencyCode} · {row.description}</Text>
        <Text style={{ fontWeight: 'bold' }}>Your queued change</Text>
        <Text>{conflictOp.kind === 'delete_transaction' ? 'Delete this transaction' : JSON.stringify(pending.changes)}</Text>
        <Button title="Keep mine (retry against the new version)" onPress={keepMine} />
        <Button title="Discard mine (keep the server version)" color="red" onPress={discardMine} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold' }}>{row.type}</Text>
      <TextInput placeholder="Amount" value={amount ?? row.amount} onChangeText={setAmount} keyboardType="decimal-pad" style={{ borderWidth: 1, padding: 8 }} />
      <Text>Currency: {row.currencyCode} (edit via a new entry — currency is fixed per transaction)</Text>
      <Text>{row.date.slice(0, 10)} · {row.description}</Text>

      <Picker label="Source account" items={assetAccounts} selectedId={sourceId ?? row.sourceName ? assetAccounts.find((a) => a.name === row.sourceName)?.id ?? null : null} onSelect={setSourceId} />
      <Picker label="Category" items={(categories ?? []).map((c) => ({ id: c.name, name: c.name }))} selectedId={categoryName ?? row.categoryName} onSelect={setCategoryName} />
      <Picker label="Budget" items={budgets ?? []} selectedId={budgetId} onSelect={setBudgetId} />
      <TextInput placeholder="Notes" value={notes ?? row.notes ?? ''} onChangeText={setNotes} style={{ borderWidth: 1, padding: 8 }} />

      <Button title="Attach receipt" onPress={() => router.push({ pathname: '/receipt', params: { attachToJournalId: row.journalId } })} />
      <Button title="Save" onPress={onSave} />
      <Button title="Delete" color="red" onPress={onDelete} />
    </ScrollView>
  );
}
