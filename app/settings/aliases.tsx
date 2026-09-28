// Payee aliases (design §6.7): payee text as it arrives — a receipt's printed merchant, a bank's
// legal name, a shorthand — mapped to the FF3 payee it books to. Added here, or learned when a
// draft's payee is corrected (app/draft/[id].tsx).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { eq } from 'drizzle-orm';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useDb } from '../../src/providers/DbProvider';
import { SearchField } from '../../src/ui/SearchField';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, BarIconButton, Button, Sheet, Row } from '../../src/ui/components';
import { TargetPickerSheet, type AliasTarget } from '../../src/ui/TargetPickerSheet';
import { aliases } from '../../src/db/schema';
import { upsertAlias, removeAlias, PAYEE } from '../../src/lookup/aliases';
import { exportAliasesJson, importAliasesJson } from '../../src/lookup/aliasTransfer';
import { TextField } from '../../src/ui/TextField';
import { useAction } from '../../src/ui/useAction';
import { confirmDestructive } from '../../src/ui/confirm';
import { normkey } from '../../src/lookup/normkey';

export default function AliasesScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const { data } = useLiveQuery(db.select().from(aliases).where(eq(aliases.kind, PAYEE)));

  const [search, setSearch] = useState('');
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [targetSheetOpen, setTargetSheetOpen] = useState(false);
  const [rawInput, setRawInput] = useState('');
  const [pickedTarget, setPickedTarget] = useState<AliasTarget | null>(null);
  const [transferSheetOpen, setTransferSheetOpen] = useState(false);
  const [transferJson, setTransferJson] = useState('');

  const rows = data ?? [];
  // normkey, like every other search: toLowerCase alone missed "Żabka" for "żabka".
  const needle = normkey(search);
  const visible = needle
    ? rows.filter(
        (r) => normkey(r.rawInput).includes(needle) || normkey(r.targetName).includes(needle),
      )
    : rows;

  function openAddSheet() {
    setRawInput('');
    setPickedTarget(null);
    setAddSheetOpen(true);
  }

  const saveAlias = act(tr('common.save'), async () => {
    if (!rawInput.trim() || !pickedTarget) return;
    await upsertAlias(db, {
      kind: PAYEE,
      rawInput: rawInput.trim(),
      targetId: pickedTarget.targetId,
      targetName: pickedTarget.targetName,
    });
    setAddSheetOpen(false);
  });

  const confirmRemove = act(
    tr('addresses.remove'),
    async (row: { kind: string; rawInput: string; targetName: string }) => {
      if (
        !(await confirmDestructive(
          tr('aliases.removeTitle', { raw: row.rawInput }),
          tr('addresses.remove'),
          tr('aliases.removeBody', { target: row.targetName }),
        ))
      )
        return;
      await removeAlias(db, row.kind, row.rawInput);
    },
  );

  const onExport = act(tr('aliases.exportOrImport'), async () => {
    setTransferJson(await exportAliasesJson(db));
    setTransferSheetOpen(true);
  });

  const onImport = act(tr('aliases.importButton'), async () => {
    if (!transferJson) return;
    const result = await importAliasesJson(db, transferJson);
    Alert.alert(
      tr('aliases.importCompleteTitle'),
      tr('aliases.importComplete', {
        imported: result.imported,
        collisions: result.collisions.length,
      }) + (result.skipped > 0 ? ` ${tr('aliases.importSkipped', { count: result.skipped })}` : ''),
    );
    setTransferSheetOpen(false);
  });

  return (
    <Screen bottom>
      <AppBar
        title={tr('aliases.title')}
        right={
          <BarIconButton
            icon="ellipsis-horizontal"
            label={tr('aliases.exportOrImport')}
            onPress={onExport}
          />
        }
      />
      <View style={{ paddingHorizontal: t.space.lg, gap: t.space.sm }}>
        <SearchField value={search} onChangeText={setSearch} placeholder={tr('aliases.search')} />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(row) => row.id}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.xs }}
        renderItem={({ item }) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: t.space.sm,
              borderBottomWidth: 1,
              borderBottomColor: t.color.border,
            }}
          >
            <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>
              {item.rawInput} → {item.targetName}
            </Text>
            <Pressable
              onPress={() => confirmRemove(item)}
              accessibilityRole="button"
              accessibilityLabel={tr('addresses.removeAddress', { address: item.rawInput })}
            >
              <Text style={[t.type.body, { color: t.color.danger }]}>✕</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <Text
            style={[
              t.type.body,
              { color: t.color.textFaint, paddingTop: t.space.xl, textAlign: 'center' },
            ]}
          >
            {tr('aliases.empty')}
          </Text>
        }
      />

      <Pressable
        onPress={openAddSheet}
        accessibilityRole="button"
        accessibilityLabel={tr('aliases.add')}
        style={({ pressed }) => ({
          position: 'absolute',
          right: t.space.lg,
          bottom: t.space.lg,
          width: 56,
          height: 56,
          borderRadius: t.radius.pill,
          backgroundColor: t.color.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
          elevation: 3,
        })}
      >
        <Text style={[t.type.title, { color: t.color.onAccent }]}>＋</Text>
      </Pressable>

      <Sheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        title={tr('aliases.newTitle')}
        footer={
          <Button
            title={tr('common.save')}
            onPress={saveAlias}
            disabled={!rawInput.trim() || !pickedTarget}
          />
        }
      >
        <TextField
          value={rawInput}
          onChangeText={setRawInput}
          placeholder={tr('aliases.rawPlaceholder')}
          autoCapitalize="none"
        />
        <Row
          label={tr('aliases.mapsTo')}
          value={pickedTarget?.targetName ?? '—'}
          chevron
          onPress={() => setTargetSheetOpen(true)}
        />
      </Sheet>

      <TargetPickerSheet
        visible={targetSheetOpen}
        onClose={() => setTargetSheetOpen(false)}
        onSelect={setPickedTarget}
      />

      <Sheet
        visible={transferSheetOpen}
        onClose={() => setTransferSheetOpen(false)}
        title={tr('aliases.transferTitle')}
        footer={
          <Button title={tr('aliases.importButton')} onPress={onImport} disabled={!transferJson} />
        }
      >
        <TextField
          value={transferJson}
          onChangeText={setTransferJson}
          multiline
          placeholder={tr('aliases.transferPlaceholder')}
          style={{ minHeight: 160 }}
        />
      </Sheet>
    </Screen>
  );
}
