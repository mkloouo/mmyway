import { useState } from 'react';
import { View, TextInput, Button, FlatList, Text, Alert } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useDb } from '../../src/providers/DbProvider';
import { aliases } from '../../src/db/schema';
import { upsertAlias, removeAlias } from '../../src/lookup/aliases';
import { exportAliasesJson, importAliasesJson } from '../../src/lookup/aliasTransfer';

const KINDS = ['payee', 'account', 'budget', 'currency'] as const;

export default function AliasesScreen() {
  const db = useDb();
  const { data } = useLiveQuery(db.select().from(aliases));
  const [kind, setKind] = useState<(typeof KINDS)[number]>('payee');
  const [rawInput, setRawInput] = useState('');
  const [targetName, setTargetName] = useState('');
  const [transferJson, setTransferJson] = useState('');

  function startEdit(row: { kind: string; rawInput: string; targetName: string }) {
    setKind(row.kind as (typeof KINDS)[number]);
    setRawInput(row.rawInput);
    setTargetName(row.targetName);
  }

  async function onSave() {
    if (!rawInput || !targetName) return;
    await upsertAlias(db, { kind, rawInput, targetId: null, targetName });
    setRawInput('');
    setTargetName('');
  }

  async function onExport() {
    setTransferJson(await exportAliasesJson(db));
  }

  async function onImport() {
    if (!transferJson) return;
    const result = await importAliasesJson(db, transferJson);
    Alert.alert(
      'Import complete',
      `Imported ${result.imported}. ${result.collisions.length} collision(s):\n` +
        result.collisions.map((c) => `${c.kind}:${c.rawInput} (kept "${c.existingTargetName}", skipped "${c.incomingTargetName}")`).join('\n'),
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {KINDS.map((k) => (
          <Text
            key={k}
            onPress={() => setKind(k)}
            style={{ padding: 6, borderWidth: 1, borderColor: k === kind ? '#000' : '#ccc', fontWeight: k === kind ? 'bold' : 'normal' }}
          >
            {k}
          </Text>
        ))}
      </View>
      <TextInput placeholder="Alias (e.g. zabka)" value={rawInput} onChangeText={setRawInput} style={{ borderWidth: 1, padding: 8 }} />
      <TextInput placeholder="Maps to (e.g. Żabka)" value={targetName} onChangeText={setTargetName} style={{ borderWidth: 1, padding: 8 }} />
      <Button title="Save alias" onPress={onSave} />

      <FlatList
        data={data ?? []}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
            <Text onPress={() => startEdit(item)}>{item.kind}: {item.rawInput} → {item.targetName}</Text>
            <Text onPress={() => removeAlias(db, item.kind, item.rawInput)} style={{ color: 'red' }}>Remove</Text>
          </View>
        )}
      />

      <Text style={{ fontWeight: 'bold', marginTop: 16 }}>Export / import</Text>
      <Button title="Export to text below" onPress={onExport} />
      <TextInput
        placeholder="Exported JSON appears here — paste JSON here to import"
        value={transferJson}
        onChangeText={setTransferJson}
        multiline
        style={{ borderWidth: 1, padding: 8, minHeight: 120 }}
      />
      <Button title="Import from text above" onPress={onImport} />
    </View>
  );
}
