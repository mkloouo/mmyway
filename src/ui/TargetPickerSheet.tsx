// Payee alias targets: FF3's expense accounts, or a name FF3 will create on first use. Storing
// the account id is what lets a matched withdrawal send destination_id (design §3.4).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text } from 'react-native';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../db/useLiveQuery';
import { Sheet } from './components';
import { SearchField } from './SearchField';
import { useTheme } from './theme';
import { useDb } from '../providers/DbProvider';
import { referenceAccounts } from '../db/schema';
import { normkey } from '../lookup/normkey';

export interface AliasTarget {
  targetId: string | null;
  targetName: string;
}

function useCandidates(enabled: boolean): AliasTarget[] {
  const db = useDb();
  const { data: accounts } = useLiveQuery(
    db.select().from(referenceAccounts).where(eq(referenceAccounts.type, 'expense')),
    [],
    enabled,
  );
  return useMemo(
    () => (accounts ?? []).map((a) => ({ targetId: a.id, targetName: a.name })),
    [accounts],
  );
}

export function TargetPickerSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (target: AliasTarget) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [query, setQuery] = useState('');
  const candidates = useCandidates(visible);
  const trimmed = query.trim();
  const results = trimmed
    ? candidates.filter((c) => normkey(c.targetName).includes(normkey(trimmed)))
    : candidates;

  // A payee FF3 doesn't have yet is fine: the expense account is created on first use.
  const allowFreeText =
    !!trimmed && !results.some((c) => normkey(c.targetName) === normkey(trimmed));

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        setQuery('');
        onClose();
      }}
      title={tr('payeeSheet.payee.choose')}
      scroll={false}
      footer={
        allowFreeText ? (
          <Pressable
            onPress={() => {
              onSelect({ targetId: null, targetName: trimmed });
              setQuery('');
              onClose();
            }}
            accessibilityRole="button"
            style={({ pressed }) => ({ paddingVertical: t.space.md, opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={[t.type.body, { color: t.color.accent, fontWeight: '600' }]}>
              {tr('pickers.useNew', { name: trimmed })}
            </Text>
          </Pressable>
        ) : undefined
      }
    >
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={tr('payeeSheet.payee.search')}
        autoFocus
        style={{ marginBottom: t.space.sm }}
      />
      <FlatList
        data={results}
        keyExtractor={(item) => item.targetId ?? item.targetName}
        style={{ flex: 1 }}
        // Keeps the right-aligned column clear of Android's scrollbar, which draws over the content.
        contentContainerStyle={{ paddingRight: t.space.md }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              onSelect(item);
              setQuery('');
              onClose();
            }}
            style={({ pressed }) => ({
              paddingVertical: t.space.sm,
              borderTopWidth: 1,
              borderTopColor: t.color.border,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[t.type.body, { color: t.color.text }]} numberOfLines={1}>
              {item.targetName}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text
            style={[
              t.type.body,
              { color: t.color.textFaint, paddingVertical: t.space.lg, textAlign: 'center' },
            ]}
          >
            {tr('pickers.noMatches')}
          </Text>
        }
      />
    </Sheet>
  );
}
