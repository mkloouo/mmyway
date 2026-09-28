// Asset accounts and the cash-envelope marker (design §6.6).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { eq } from 'drizzle-orm';
import { useDb } from '../../src/providers/DbProvider';
import { SearchField } from '../../src/ui/SearchField';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, BarIconButton, Card, Row, Sheet, Chip, Button } from '../../src/ui/components';
import { referenceAccounts } from '../../src/db/schema';
import { hasEnvelopeMarker, setEnvelopeMarker } from '../../src/accounts/envelopeMarker';
import { useAssetAccounts, type ReferenceAccountRow } from '../../src/accounts/useAssetAccounts';
import { setAccountActive, reorderAccounts } from '../../src/accounts/accountActions';
import { filterAccounts } from '../../src/accounts/filterAccounts';
import { enqueueOperation } from '../../src/sync/outbox';
import { generateId } from '../../src/utils/id';

type AccountRow = ReferenceAccountRow;

export default function AccountsScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  // In FF3's own order — the order every account picker in the app uses, set with Reorder.
  const allAccounts = useAssetAccounts({ includeInactive: true }) ?? [];
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [search, setSearch] = useState('');
  const [reordering, setReordering] = useState(false);
  const visible = reordering ? allAccounts : filterAccounts(allAccounts, search);

  async function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= allAccounts.length) return;
    const ids = allAccounts.map((a) => a.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    await reorderAccounts(db, ids);
  }

  async function toggleEnvelope(account: AccountRow) {
    const next = !hasEnvelopeMarker(account.notes);
    const nextNotes = setEnvelopeMarker(account.notes, next);
    await db.update(referenceAccounts).set({ notes: nextNotes }).where(eq(referenceAccounts.id, account.id));
    await enqueueOperation(db, { id: generateId(), kind: 'update_account', payload: { accountId: account.id, setEnvelopeMarker: next } });
    setEditing((cur) => (cur && cur.id === account.id ? { ...cur, notes: nextNotes } : cur));
  }

  async function toggleActive(account: AccountRow) {
    const next = !account.active;
    await setAccountActive(db, account.id, next);
    setEditing((cur) => (cur && cur.id === account.id ? { ...cur, active: next } : cur));
  }

  return (
    <Screen bottom>
      <AppBar
        title={tr('accounts.title')}
        right={(
          reordering ? (
            <Button title={tr('common.done')} variant="ghost" size="bar" onPress={() => setReordering(false)} />
          ) : (
            <BarIconButton icon="swap-vertical" label={tr('accounts.reorder')} onPress={() => { setReordering(true); setSearch(''); }} />
          )
        )}
      />
      {reordering ? (
        <Text style={[t.type.label, { color: t.color.textMuted, paddingHorizontal: t.space.lg }]}>
          {tr('accounts.reorderHint')}
        </Text>
      ) : (
        <View style={{ paddingHorizontal: t.space.lg }}>
          <SearchField value={search} onChangeText={setSearch} placeholder={tr('pickers.searchAccounts')} />
        </View>
      )}
      <FlatList
        data={visible}
        keyExtractor={(a) => a.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.sm }}
        renderItem={({ item, index }) => (
          <Card onPress={reordering ? undefined : () => setEditing(item)} style={item.active ? undefined : { opacity: 0.5 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
              <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>{item.name}</Text>
              {!item.active && <Chip label={tr('accounts.inactive')} />}
              {hasEnvelopeMarker(item.notes) && <Chip label={tr('accounts.envelope')} />}
              {reordering ? (
                <View style={{ flexDirection: 'row', gap: t.space.xs }}>
                  <Pressable onPress={() => move(index, -1)} disabled={index === 0} accessibilityRole="button" accessibilityLabel={tr('accounts.moveUp', { name: item.name })} hitSlop={8}>
                    <Ionicons name="chevron-up" size={22} color={index === 0 ? t.color.textFaint : t.color.accent} />
                  </Pressable>
                  <Pressable onPress={() => move(index, 1)} disabled={index === visible.length - 1} accessibilityRole="button" accessibilityLabel={tr('accounts.moveDown', { name: item.name })} hitSlop={8}>
                    <Ionicons name="chevron-down" size={22} color={index === visible.length - 1 ? t.color.textFaint : t.color.accent} />
                  </Pressable>
                </View>
              ) : (
                <Text style={[t.type.body, { color: t.color.textFaint }]}>›</Text>
              )}
            </View>
          </Card>
        )}
        ListEmptyComponent={<Text style={[t.type.body, { color: t.color.textFaint, textAlign: 'center', paddingTop: t.space.xl }]}>{tr('accounts.empty')}</Text>}
      />

      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.name ?? ''}
        footer={<Button title={tr('common.done')} onPress={() => setEditing(null)} />}
      >
        {!!editing && (
          <View>
            <Row first label={tr('accounts.name')} value={editing.name} />
            <Row label={tr('fields.currency')} value={editing.currencyCode} />
            <Checkbox
              checked={editing.active}
              onPress={() => toggleActive(editing)}
              label={tr('accounts.active')}
              hint={tr('accounts.activeHint')}
            />
            <Checkbox
              checked={hasEnvelopeMarker(editing.notes)}
              onPress={() => toggleEnvelope(editing)}
              label={tr('accounts.cashEnvelope')}
              hint={tr('accounts.cashEnvelopeHint')}
            />
          </View>
        )}
      </Sheet>
    </Screen>
  );
}

function Checkbox({ checked, onPress, label, hint }: { checked: boolean; onPress: () => void; label: string; hint: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingVertical: t.space.md }}
    >
      <View
        style={{
          width: 22, height: 22, borderRadius: t.radius.sm, borderWidth: 1.5,
          borderColor: checked ? t.color.accent : t.color.border,
          backgroundColor: checked ? t.color.accent : 'transparent',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        {checked && <Text style={{ color: t.color.onAccent, fontSize: 14 }}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[t.type.body, { color: t.color.text }]}>{label}</Text>
        <Text style={[t.type.label, { color: t.color.textMuted }]}>{hint}</Text>
      </View>
    </Pressable>
  );
}
