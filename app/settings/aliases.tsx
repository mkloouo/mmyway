import { useState } from 'react';
import { View, TextInput, Button, FlatList, Text } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useDb } from '../../src/app/DbProvider';
import { aliases } from '../../src/db/schema';
import { upsertAlias, removeAlias } from '../../src/lookup/aliases';

export default function AliasesScreen() {
  const db = useDb();
  const { data } = useLiveQuery(db.select().from(aliases));
  const [rawInput, setRawInput] = useState('');
  const [targetName, setTargetName] = useState('');

  return (
    <View style={{ flex: 1, padding: 16, gap: 8 }}>
      <TextInput placeholder="Alias (e.g. zabka)" value={rawInput} onChangeText={setRawInput} style={{ borderWidth: 1, padding: 8 }} />
      <TextInput placeholder="Maps to (e.g. Żabka)" value={targetName} onChangeText={setTargetName} style={{ borderWidth: 1, padding: 8 }} />
      <Button
        title="Add payee alias"
        onPress={async () => {
          await upsertAlias(db, { kind: 'payee', rawInput, targetId: null, targetName });
          setRawInput('');
          setTargetName('');
        }}
      />
      <FlatList
        data={data ?? []}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
            <Text>{item.kind}: {item.rawInput} → {item.targetName}</Text>
            <Text onPress={() => removeAlias(db, item.kind, item.rawInput)} style={{ color: 'red' }}>Remove</Text>
          </View>
        )}
      />
    </View>
  );
}
