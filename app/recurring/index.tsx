import { useState } from 'react';
import { View, Text, Button, FlatList, TextInput } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';
import { useDb } from '../../src/providers/DbProvider';
import { referenceAccounts, inboxItems } from '../../src/db/schema';
import { approveRecurringReview, editRecurringReview, deleteRecurringReview } from '../../src/sync/recurringReview';

export default function RecurringReviewScreen() {
  const db = useDb();
  const { data } = useLiveQuery(db.select().from(inboxItems).where(eq(inboxItems.kind, 'recurring_review')));
  const { data: accounts } = useLiveQuery(db.select().from(referenceAccounts));
  const assetAccounts = (accounts ?? []).filter((a) => a.type === 'asset');
  const pending = (data ?? []).filter((item) => item.state === 'confirmed');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);

  function startEdit(item: (typeof pending)[number]) {
    const journal = JSON.parse(item.draftJson);
    setEditingId(item.id);
    setAmount(journal.amount ?? '');
    setCurrencyCode(journal.currency_code ?? '');
    setAccountId(journal.source_id ?? null);
  }

  async function saveEdit() {
    if (!editingId) return;
    await editRecurringReview(db, editingId, {
      amount, currency_code: currencyCode,
      ...(accountId ? { source_id: accountId } : {}),
    });
    setEditingId(null);
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <FlatList
        data={pending}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const journal = JSON.parse(item.draftJson);
          const editing = editingId === item.id;
          return (
            <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: '#ddd', gap: 4 }}>
              <Text>{journal.description} · {journal.amount} {journal.currency_code}</Text>
              {editing ? (
                <View style={{ gap: 4 }}>
                  <TextInput placeholder="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={{ borderWidth: 1, padding: 8 }} />
                  <TextInput placeholder="Currency" value={currencyCode} onChangeText={setCurrencyCode} style={{ borderWidth: 1, padding: 8 }} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {assetAccounts.map((a) => (
                      <Text
                        key={a.id}
                        onPress={() => setAccountId(a.id)}
                        style={{ padding: 6, borderWidth: 1, borderColor: a.id === accountId ? '#000' : '#ccc', fontWeight: a.id === accountId ? 'bold' : 'normal' }}
                      >
                        {a.name}
                      </Text>
                    ))}
                  </View>
                  <Button title="Save & approve" onPress={saveEdit} />
                  <Button title="Cancel" onPress={() => setEditingId(null)} />
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Approve" onPress={() => approveRecurringReview(db, item.id)} />
                  <Button title="Edit" onPress={() => startEdit(item)} />
                  <Button title="Delete" color="red" onPress={() => deleteRecurringReview(db, item.id)} />
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}
