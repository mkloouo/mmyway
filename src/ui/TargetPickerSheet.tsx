// Alias targets, picked from the reference tables (design §6.7) — this is what makes the §3.4
// destination_id fix reachable from the UI: an alias now stores targetId, not just a name.
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text } from 'react-native';
import { useLiveQuery } from '../db/useLiveQuery';
import { Sheet } from './components';
import { SearchField } from './SearchField';
import { useTheme } from './theme';
import { useDb } from '../providers/DbProvider';
import { referenceAccounts, referenceBudgets, referenceCurrencies } from '../db/schema';
import { useAssetAccounts } from '../accounts/useAssetAccounts';
import { normkey } from '../lookup/normkey';

export type AliasKind = 'payee' | 'account' | 'budget' | 'currency';
export interface AliasTarget {
  targetId: string | null;
  targetName: string;
}

function useCandidates(kind: AliasKind): AliasTarget[] {
  const db = useDb();
  const { data: accounts } = useLiveQuery(db.select().from(referenceAccounts));
  const assetAccounts = useAssetAccounts();
  const { data: budgets } = useLiveQuery(db.select().from(referenceBudgets));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));

  return useMemo(() => {
    if (kind === 'payee') return (accounts ?? []).filter((a) => a.type === 'expense').map((a) => ({ targetId: a.id, targetName: a.name }));
    if (kind === 'account') return (assetAccounts ?? []).map((a) => ({ targetId: a.id, targetName: a.name }));
    if (kind === 'budget') return (budgets ?? []).map((b) => ({ targetId: b.id, targetName: b.name }));
    return (currencies ?? []).map((c) => ({ targetId: c.code, targetName: c.code }));
  }, [kind, accounts, assetAccounts, budgets, currencies]);
}

export function TargetPickerSheet({
  visible, onClose, kind, onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  kind: AliasKind;
  onSelect: (target: AliasTarget) => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const candidates = useCandidates(kind);
  const trimmed = query.trim();
  const results = trimmed
    ? candidates.filter((c) => normkey(c.targetName).includes(normkey(trimmed)))
    : candidates;

  // Only a payee can reference something FF3 doesn't have yet — an expense account is created on
  // first use. Asset accounts, budgets and currencies must already exist.
  const allowFreeText = kind === 'payee' && !!trimmed && !results.some((c) => normkey(c.targetName) === normkey(trimmed));

  return (
    <Sheet
      visible={visible}
      onClose={() => { setQuery(''); onClose(); }}
      title={`Choose a ${kind}`}
      scroll={false}
      footer={allowFreeText ? (
        <Pressable
          onPress={() => { onSelect({ targetId: null, targetName: trimmed }); setQuery(''); onClose(); }}
          accessibilityRole="button"
          style={({ pressed }) => ({ paddingVertical: t.space.md, opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={[t.type.body, { color: t.color.accent, fontWeight: '600' }]}>Use &quot;{trimmed}&quot; (will be created)</Text>
        </Pressable>
      ) : undefined}
    >
      <SearchField value={query} onChangeText={setQuery} placeholder={`Search ${kind}s`} autoFocus style={{ marginBottom: t.space.sm }} />
      <FlatList
        data={results}
        keyExtractor={(item) => item.targetId ?? item.targetName}
        style={{ flex: 1 }}
        // Keeps the right-aligned column clear of Android's scrollbar, which draws over the content.
        contentContainerStyle={{ paddingRight: t.space.md }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { onSelect(item); setQuery(''); onClose(); }}
            style={({ pressed }) => ({
              paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border, opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[t.type.body, { color: t.color.text }]} numberOfLines={1}>{item.targetName}</Text>
          </Pressable>
        )}
        ListEmptyComponent={(
          <Text style={[t.type.body, { color: t.color.textFaint, paddingVertical: t.space.lg, textAlign: 'center' }]}>No matches</Text>
        )}
      />
    </Sheet>
  );
}
