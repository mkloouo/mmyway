// Search + live re-rank over merchant history (design §6.2). Uses Sheet's list mode: the
// history can be ~400 rows, which a ScrollView must not try to mount at once.
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput } from 'react-native';
import { Sheet } from './components';
import { useTheme } from './theme';
import { rankCandidates } from '../suggest/rank';
import type { MerchantHistory } from '../lookup/merchantLookup';

export function PayeeSheet({
  visible, onClose, histories, onSelect, onCreateNew, payeeLabel,
}: {
  visible: boolean;
  onClose: () => void;
  histories: MerchantHistory[];
  onSelect: (history: MerchantHistory) => void;
  onCreateNew: (rawText: string) => void;
  payeeLabel: string; // "payee" or "payer", matches the screen's transaction type
}) {
  const t = useTheme();
  const [query, setQuery] = useState('');

  const byKey = useMemo(() => new Map(histories.map((h) => [h.merchantKey, h])), [histories]);
  const results = useMemo(() => {
    const ranked = rankCandidates(histories, { merchantQuery: query || undefined });
    return ranked.map((c) => byKey.get(c.merchantKey)).filter((h): h is MerchantHistory => !!h);
  }, [histories, byKey, query]);

  const trimmed = query.trim();

  return (
    <Sheet
      visible={visible}
      onClose={() => { setQuery(''); onClose(); }}
      title={`Choose a ${payeeLabel}`}
      scroll={false}
      footer={!!trimmed && (
        <Pressable
          onPress={() => { onCreateNew(trimmed); setQuery(''); onClose(); }}
          accessibilityRole="button"
          style={({ pressed }) => ({
            paddingVertical: t.space.md, opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={[t.type.body, { color: t.color.accent, fontWeight: '600' }]}>Create new {payeeLabel} &quot;{trimmed}&quot;</Text>
        </Pressable>
      )}
    >
      <TextInput
        placeholder={`Search ${payeeLabel}s`}
        value={query}
        onChangeText={setQuery}
        autoFocus
        placeholderTextColor={t.color.textFaint}
        style={{
          borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm,
          paddingHorizontal: t.space.md, paddingVertical: t.space.sm, color: t.color.text,
          marginBottom: t.space.sm,
        }}
      />
      <FlatList
        data={results}
        keyExtractor={(h) => h.merchantKey}
        style={{ flex: 1 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { onSelect(item); setQuery(''); onClose(); }}
            style={({ pressed }) => ({
              paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.color.border,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[t.type.body, { color: t.color.text }]} numberOfLines={1}>{item.displayName}</Text>
            <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
              {[item.topCategory, item.topAccountName].filter(Boolean).join(' · ') || `${item.occurrences}×`}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={(
          <Text style={[t.type.body, { color: t.color.textFaint, paddingVertical: t.space.lg, textAlign: 'center' }]}>
            No matches
          </Text>
        )}
      />
    </Sheet>
  );
}
