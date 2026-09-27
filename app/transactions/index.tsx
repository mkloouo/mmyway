import { useState } from 'react';
import { View, TextInput, FlatList, Text } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useDb } from '../../src/app/DbProvider';
import { cachedTransactions } from '../../src/db/schema';

export default function TransactionsScreen() {
  const db = useDb();
  const [query, setQuery] = useState('');
  const { data } = useLiveQuery(db.select().from(cachedTransactions));
  const filtered = (data ?? []).filter((row) =>
    row.description.toLowerCase().includes(query.toLowerCase()) ||
    (row.destinationName ?? '').toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <TextInput placeholder="Search" value={query} onChangeText={setQuery} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <FlatList
        data={filtered}
        keyExtractor={(row) => row.groupId}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: '#ddd' }}>
            <Text>{item.date.slice(0, 10)} · {item.description} · {item.amount} {item.currencyCode}</Text>
          </View>
        )}
      />
    </View>
  );
}
