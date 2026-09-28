// Asset accounts in FF3's order (design §6.6). Tap or long-press one to open its page
// (app/accounts/[id].tsx); Reorder moves it.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDb } from '../../src/providers/DbProvider';
import { SearchField } from '../../src/ui/SearchField';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, BarIconButton, Card, Chip, Button } from '../../src/ui/components';
import { hasEnvelopeMarker } from '../../src/accounts/envelopeMarker';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import { reorderAccounts } from '../../src/accounts/accountActions';
import { filterAccounts } from '../../src/accounts/filterAccounts';
import { navigateOnce } from '../../src/ui/navigateOnce';

export default function AccountsScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  // In FF3's own order — the order every account picker in the app uses, set with Reorder.
  const allAccounts = useAssetAccounts({ includeInactive: true }) ?? [];
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
          <Card
            onPress={reordering ? undefined : () => navigateOnce(`/accounts/${item.id}`)}
            onLongPress={() => navigateOnce(`/accounts/${item.id}`)}
            style={item.active ? undefined : { opacity: 0.5 }}>
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

    </Screen>
  );
}
