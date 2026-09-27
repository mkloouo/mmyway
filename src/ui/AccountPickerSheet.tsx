// One search-and-pick sheet for asset accounts, on top of the shared Sheet (design §4). Every
// account is already local via fetchAll, so the search over filterAccounts is instant and offline.
import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput } from 'react-native';
import { Sheet } from './components';
import { useTheme } from './theme';
import { filterAccounts } from '../accounts/filterAccounts';
import { currencyOf, formatMoney } from './money';

export interface AccountPickerAccount {
  id: string;
  name: string;
  currencyCode: string;
  currentBalance?: string | null;
}

export function AccountPickerSheet({
  visible, onClose, title, accounts, currencies, excludeId, onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  accounts: AccountPickerAccount[];
  currencies: { code: string; symbol: string; decimalPlaces: number }[];
  /** Leaves the chosen source out of a transfer's destination list. */
  excludeId?: string | null;
  onSelect: (account: AccountPickerAccount) => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const candidates = excludeId ? accounts.filter((a) => a.id !== excludeId) : accounts;
  const results = filterAccounts(candidates, query);

  return (
    <Sheet visible={visible} onClose={() => { setQuery(''); onClose(); }} title={title} scroll={false}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search accounts"
        autoFocus
        placeholderTextColor={t.color.textFaint}
        style={{
          borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm,
          paddingHorizontal: t.space.md, paddingVertical: t.space.sm, color: t.color.text, marginBottom: t.space.sm,
        }}
      />
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        style={{ flex: 1 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { onSelect(item); setQuery(''); onClose(); }}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: t.space.md,
              paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border, opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>{item.name}</Text>
            {item.currentBalance != null && (
              <Text style={[t.type.label, { color: t.color.textMuted }]}>
                {formatMoney(item.currentBalance, currencyOf(currencies, item.currencyCode))}
              </Text>
            )}
          </Pressable>
        )}
        ListEmptyComponent={(
          <Text style={[t.type.body, { color: t.color.textFaint, paddingVertical: t.space.lg, textAlign: 'center' }]}>No matches</Text>
        )}
      />
    </Sheet>
  );
}
