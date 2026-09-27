// Alias targets, picked from the reference tables (design §6.7) — this is what makes the §3.4
// destination_id fix reachable from the UI: an alias now stores targetId, not just a name.
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput } from 'react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Sheet } from './components';
import { useTheme } from './theme';
import { useDb } from '../providers/DbProvider';
import { referenceAccounts, referenceBudgets, referenceCurrencies } from '../db/schema';
import { normkey } from '../lookup/normkey';

export type AliasKind = 'payee' | 'account' | 'budget' | 'currency';
export interface AliasTarget {
  targetId: string | null;
  targetName: string;
}

function useCandidates(kind: AliasKind): AliasTarget[] {
  const db = useDb();
  const { data: accounts } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: budgets } = useLiveQuery(db.select().from(referenceBudgets));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));

  return useMemo(() => {
    if (kind === 'payee') return (accounts ?? []).filter((a) => a.type === 'expense').map((a) => ({ targetId: a.id, targetName: a.name }));
    if (kind === 'account') return (accounts ?? []).filter((a) => a.type === 'asset').map((a) => ({ targetId: a.id, targetName: a.name }));
    if (kind === 'budget') return (budgets ?? []).map((b) => ({ targetId: b.id, targetName: b.name }));
    return (currencies ?? []).map((c) => ({ targetId: c.code, targetName: c.code }));
  }, [kind, accounts, budgets, currencies]);
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
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={`Search ${kind}s`}
        autoFocus
        placeholderTextColor={t.color.textFaint}
        style={{
          borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm,
          paddingHorizontal: t.space.md, paddingVertical: t.space.sm, color: t.color.text, marginBottom: t.space.sm,
        }}
      />
      <FlatList
        data={results}
        keyExtractor={(item) => item.targetId ?? item.targetName}
        style={{ flex: 1 }}
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
