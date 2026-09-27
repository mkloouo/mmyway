import { useState } from 'react';
import { View, Text, TextInput, Button, FlatList } from 'react-native';
import { router, Link } from 'expo-router';
import { useDb } from '../src/providers/DbProvider';
import { useInboxItems } from '../src/inbox/useInboxItems';
import { createManualEntry } from '../src/inbox/createManualEntry';

export default function InboxScreen() {
  const db = useDb();
  const { data: items } = useInboxItems();
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');

  async function onCapture() {
    if (!amount || !merchant) return;
    const { inboxItemId } = await createManualEntry(db, {
      type: 'withdrawal', amount, currencyCode: 'PLN', date: new Date().toISOString(),
      description: merchant, merchantRawInput: merchant,
    });
    setAmount('');
    setMerchant('');
    router.push(`/draft/${inboxItemId}`);
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 8 }}>
      <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Inbox</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Link href="/transactions">Transactions</Link>
        <Link href="/recurring">Recurring</Link>
        <Link href="/settings">Settings</Link>
        <Link href="/settings/aliases">Aliases</Link>
      </View>
      <TextInput placeholder="Merchant" value={merchant} onChangeText={setMerchant} style={{ borderWidth: 1, padding: 8 }} />
      <TextInput placeholder="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={{ borderWidth: 1, padding: 8 }} />
      <Button title="Capture" onPress={onCapture} />
      <FlatList
        data={items ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: '#ddd' }}>
            <Text onPress={() => router.push(`/draft/${item.id}`)}>
              {item.kind} · {item.state}
            </Text>
          </View>
        )}
      />
    </View>
  );
}
