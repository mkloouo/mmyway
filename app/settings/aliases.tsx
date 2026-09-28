// Payee aliases (design §6.7): payee text as it arrives — a receipt's printed merchant, a bank's
// legal name, a shorthand — mapped to the FF3 payee it books to. Added here, or learned when a
// draft's payee is corrected (app/draft/[id].tsx).
import { useState } from 'react';
import { eq } from 'drizzle-orm';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useDb } from '../../src/providers/DbProvider';
import { SearchField } from '../../src/ui/SearchField';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, BarIconButton, Button, Sheet, Row } from '../../src/ui/components';
import { TargetPickerSheet, type AliasTarget } from '../../src/ui/TargetPickerSheet';
import { aliases } from '../../src/db/schema';
import { upsertAlias, removeAlias, PAYEE } from '../../src/lookup/aliases';
import { exportAliasesJson, importAliasesJson } from '../../src/lookup/aliasTransfer';

export default function AliasesScreen() {
  const db = useDb();
  const t = useTheme();
  const { data } = useLiveQuery(db.select().from(aliases).where(eq(aliases.kind, PAYEE)));

  const [search, setSearch] = useState('');
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [targetSheetOpen, setTargetSheetOpen] = useState(false);
  const [rawInput, setRawInput] = useState('');
  const [pickedTarget, setPickedTarget] = useState<AliasTarget | null>(null);
  const [transferSheetOpen, setTransferSheetOpen] = useState(false);
  const [transferJson, setTransferJson] = useState('');

  const rows = data ?? [];
  const visible = rows
    .filter((r) => !search.trim() || r.rawInput.toLowerCase().includes(search.trim().toLowerCase()) || r.targetName.toLowerCase().includes(search.trim().toLowerCase()));

  function openAddSheet() {
    setRawInput('');
    setPickedTarget(null);
    setAddSheetOpen(true);
  }

  async function saveAlias() {
    if (!rawInput.trim() || !pickedTarget) return;
    await upsertAlias(db, { kind: PAYEE, rawInput: rawInput.trim(), targetId: pickedTarget.targetId, targetName: pickedTarget.targetName });
    setAddSheetOpen(false);
  }

  function confirmRemove(row: { kind: string; rawInput: string; targetName: string }) {
    Alert.alert(`Remove "${row.rawInput}"?`, `It will no longer map to ${row.targetName}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeAlias(db, row.kind, row.rawInput) },
    ]);
  }

  async function onExport() {
    setTransferJson(await exportAliasesJson(db));
    setTransferSheetOpen(true);
  }

  async function onImport() {
    if (!transferJson) return;
    const result = await importAliasesJson(db, transferJson);
    Alert.alert(
      'Import complete',
      `Imported ${result.imported}. ${result.collisions.length} collision(s) kept the existing mapping.`
        + (result.skipped > 0 ? ` Skipped ${result.skipped} account, budget or currency alias(es) — only payee aliases are used.` : ''),
    );
    setTransferSheetOpen(false);
  }

  return (
    <Screen bottom>
      <AppBar
        title="Aliases"
        right={(
          <BarIconButton icon="ellipsis-horizontal" label="Export or import" onPress={onExport} />
        )}
      />
      <View style={{ paddingHorizontal: t.space.lg, gap: t.space.sm }}>
        <SearchField value={search} onChangeText={setSearch} placeholder="Search aliases" />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(row) => row.id}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.xs }}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: t.space.sm, borderBottomWidth: 1, borderBottomColor: t.color.border }}>
            <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>{item.rawInput} → {item.targetName}</Text>
            <Pressable onPress={() => confirmRemove(item)} accessibilityRole="button" accessibilityLabel={`Remove ${item.rawInput}`}>
              <Text style={[t.type.body, { color: t.color.danger }]}>✕</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<Text style={[t.type.body, { color: t.color.textFaint, paddingTop: t.space.xl, textAlign: 'center' }]}>No aliases yet</Text>}
      />

      <Pressable
        onPress={openAddSheet}
        accessibilityRole="button"
        accessibilityLabel="Add alias"
        style={({ pressed }) => ({
          position: 'absolute', right: t.space.lg, bottom: t.space.lg, width: 56, height: 56, borderRadius: t.radius.pill,
          backgroundColor: t.color.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1, elevation: 3,
        })}
      >
        <Text style={[t.type.title, { color: t.color.onAccent }]}>＋</Text>
      </Pressable>

      <Sheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        title="New payee alias"
        footer={<Button title="Save" onPress={saveAlias} disabled={!rawInput.trim() || !pickedTarget} />}
      >
        <TextInput
          value={rawInput}
          onChangeText={setRawInput}
          placeholder="e.g. zabka"
          placeholderTextColor={t.color.textFaint}
          autoCapitalize="none"
          style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, paddingHorizontal: t.space.md, paddingVertical: t.space.sm, color: t.color.text }}
        />
        <Row
          label="Maps to"
          value={pickedTarget?.targetName ?? '—'}
          chevron
          onPress={() => setTargetSheetOpen(true)}
        />
      </Sheet>

      <TargetPickerSheet visible={targetSheetOpen} onClose={() => setTargetSheetOpen(false)} onSelect={setPickedTarget} />

      <Sheet
        visible={transferSheetOpen}
        onClose={() => setTransferSheetOpen(false)}
        title="Export / import"
        footer={<Button title="Import from text below" onPress={onImport} disabled={!transferJson} />}
      >
        <TextInput
          value={transferJson}
          onChangeText={setTransferJson}
          multiline
          placeholder="Exported JSON appears here — paste JSON here to import"
          placeholderTextColor={t.color.textFaint}
          style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text, minHeight: 160 }}
        />
      </Sheet>
    </Screen>
  );
}
