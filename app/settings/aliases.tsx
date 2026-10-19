import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useDb } from '../../src/providers/DbProvider';
import { SearchField } from '../../src/ui/SearchField';
import { useTheme, hitSize } from '../../src/ui/theme';
import {
  Button,
  Card,
  IconButton,
  ListRow,
  PushHeader,
  SCREEN_TOP_PADDING,
  Screen,
  Sheet,
  Toast,
} from '../../src/ui/kit';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { payeeAliases } from '../../src/db/schema';
import { rememberPayeeAlias, removePayeeAlias, removePayeeGroup } from '../../src/lookup/aliases';
import { exportAliasesJson, importAliasesJson } from '../../src/lookup/aliasTransfer';
import { TextField } from '../../src/ui/TextField';
import { useAction } from '../../src/ui/useAction';
import { confirmDestructive } from '../../src/ui/confirm';
import { useToast } from '../../src/ui/useToast';
import { normkey } from '../../src/lookup/normkey';
import { RequireFlag } from '../../src/flags/RequireFlag';

interface PayeeGroupView {
  payeeName: string;
  aliases: { id: string; alias: string }[];
}

function AliasesPage() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const [toast, showToast] = useToast();

  const { data: aliasRows } = useLiveQuery(db.select().from(payeeAliases));

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Add alias sheet state
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [targetPayee, setTargetPayee] = useState('');
  const [newAlias, setNewAlias] = useState('');

  // Transfer sheet state
  const [transferSheetOpen, setTransferSheetOpen] = useState(false);
  const [transferJson, setTransferJson] = useState('');

  const groups: PayeeGroupView[] = useMemo(() => {
    const map = new Map<string, { id: string; alias: string }[]>();
    for (const row of aliasRows ?? []) {
      const list = map.get(row.payeeName) ?? [];
      list.push({ id: row.id, alias: row.alias });
      map.set(row.payeeName, list);
    }
    return Array.from(map.entries())
      .map(([payeeName, aliases]) => ({
        payeeName,
        aliases: aliases.sort((a, b) => a.alias.localeCompare(b.alias)),
      }))
      .sort((a, b) => a.payeeName.localeCompare(b.payeeName));
  }, [aliasRows]);

  const needle = normkey(search);
  const visible = useMemo(() => {
    if (!needle) return groups;
    return groups.filter(
      (g) =>
        normkey(g.payeeName).includes(needle) ||
        g.aliases.some((a) => normkey(a.alias).includes(needle)),
    );
  }, [groups, needle]);

  // The payee being edited, when it already has aliases: its aliases can be removed in the sheet.
  const editing = groups.find((g) => g.payeeName === targetPayee.trim());

  function openAddSheet(payee = '') {
    setTargetPayee(payee);
    setNewAlias('');
    setAddSheetOpen(true);
  }

  const handleSaveAlias = act(tr('common.save'), async () => {
    if (!targetPayee.trim() || !newAlias.trim()) return;
    const learned = await rememberPayeeAlias(db, newAlias.trim(), targetPayee.trim());
    if (learned) {
      setAddSheetOpen(false);
      setTargetPayee('');
      setNewAlias('');
    }
  });

  const handleDeleteAlias = act(tr('common.delete'), async (alias: string, payee: string) => {
    const ok = await confirmDestructive(
      tr('aliases.removeAliasTitle'),
      tr('common.delete'),
      tr('aliases.removeAliasBody', { alias, payee }),
    );
    if (!ok) return;
    await removePayeeAlias(db, alias);
  });

  const handleDeleteGroup = act(tr('common.delete'), async (group: PayeeGroupView) => {
    const ok = await confirmDestructive(
      tr('aliases.removeGroupTitle', { payee: group.payeeName }),
      tr('common.delete'),
      tr('aliases.removeGroupBody', { count: group.aliases.length }),
    );
    if (!ok) return;
    await removePayeeGroup(db, group.payeeName);
  });

  const openTransferSheet = act(tr('aliases.exportOrImport'), async () => {
    const json = await exportAliasesJson(db);
    setTransferJson(json);
    setTransferSheetOpen(true);
  });

  const handleImport = act(tr('aliases.importButton'), async () => {
    try {
      const { importedCount } = await importAliasesJson(db, transferJson);
      setTransferSheetOpen(false);
      showToast(tr('aliases.importComplete', { count: importedCount }));
    } catch {
      showToast('Invalid JSON format');
    }
  });

  const empty = (
    <View style={{ alignItems: 'center', padding: t.space.xl, gap: t.space.sm }}>
      <Text style={[t.type.heading, { color: t.color.textFaint }]}>{tr('aliases.empty')}</Text>
      <Text style={[t.type.body, { color: t.color.textMuted, textAlign: 'center' }]}>
        {tr('aliases.emptyHint')}
      </Text>
      <Button
        title={tr('aliases.add')}
        onPress={() => openAddSheet()}
        style={{ marginTop: t.space.md }}
      />
    </View>
  );

  return (
    <Screen bottom>
      {searchOpen ? (
        <View
          style={{
            minHeight: hitSize,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: t.space.lg,
            paddingVertical: t.space.xs,
          }}
        >
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={tr('aliases.search')}
            autoFocus
            onClear={() => {
              setSearch('');
              setSearchOpen(false);
            }}
            style={{ flex: 1 }}
          />
        </View>
      ) : (
        <PushHeader
          backLabel={tr('settings.title')}
          onBack={() => router.back()}
          title={tr('aliases.title')}
          right={
            <>
              <IconButton
                icon="search"
                label={tr('aliases.search')}
                onPress={() => setSearchOpen(true)}
              />
              <IconButton
                icon="swap-horizontal"
                label={tr('aliases.exportOrImport')}
                onPress={openTransferSheet}
              />
              <IconButton icon="add" label={tr('aliases.add')} onPress={() => openAddSheet()} />
            </>
          }
        />
      )}

      <ScrollView
        contentContainerStyle={{
          padding: t.space.lg,
          paddingTop: SCREEN_TOP_PADDING,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {visible.length === 0 ? (
          empty
        ) : (
          <Card flush>
            {visible.map((group, i) => (
              <ListRow
                key={group.payeeName}
                first={i === 0}
                label={group.payeeName}
                sub={group.aliases.map((a) => a.alias).join(', ')}
                onPress={() => openAddSheet(group.payeeName)}
                trailing={
                  <IconButton
                    icon="trash-outline"
                    label={tr('common.delete')}
                    onPress={() => handleDeleteGroup(group)}
                  />
                }
              />
            ))}
          </Card>
        )}
      </ScrollView>

      <Toast message={toast} />

      {/* Add Alias Sheet */}
      <Sheet
        visible={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        title={tr('aliases.newTitle')}
        footer={
          <Button
            title={tr('common.save')}
            onPress={handleSaveAlias}
            disabled={!targetPayee.trim() || !newAlias.trim()}
          />
        }
      >
        <Card style={{ gap: t.space.md }}>
          <View style={{ gap: t.space.xs }}>
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {tr('aliases.truePayee')}
            </Text>
            <TextField
              value={targetPayee}
              onChangeText={setTargetPayee}
              placeholder={tr('aliases.payeePlaceholder')}
            />
          </View>
          <View style={{ gap: t.space.xs }}>
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {tr('aliases.aliasLabel')}
            </Text>
            <TextField
              value={newAlias}
              onChangeText={setNewAlias}
              placeholder={tr('aliases.aliasPlaceholder')}
            />
          </View>
        </Card>
        {!!editing && (
          <Card flush>
            {editing.aliases.map((a, i) => (
              <ListRow
                key={a.id}
                first={i === 0}
                label={a.alias}
                trailing={
                  <IconButton
                    icon="trash-outline"
                    label={tr('common.delete')}
                    onPress={() => handleDeleteAlias(a.alias, editing.payeeName)}
                  />
                }
              />
            ))}
          </Card>
        )}
      </Sheet>

      {/* Export / Import Sheet */}
      <Sheet
        visible={transferSheetOpen}
        onClose={() => setTransferSheetOpen(false)}
        title={tr('aliases.transferTitle')}
        footer={
          <Button
            title={tr('aliases.importButton')}
            onPress={handleImport}
            disabled={!transferJson.trim()}
          />
        }
      >
        <TextField
          value={transferJson}
          onChangeText={setTransferJson}
          placeholder={tr('aliases.transferPlaceholder')}
          multiline
          numberOfLines={10}
          style={{ minHeight: 180, textAlignVertical: 'top' }}
        />
      </Sheet>
    </Screen>
  );
}

export default function AliasesRoute() {
  return (
    <RequireFlag name="payee_nicknames">
      <AliasesPage />
    </RequireFlag>
  );
}
