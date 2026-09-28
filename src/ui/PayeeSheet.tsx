// Search + live re-rank over merchant history (design §6.2). Uses Sheet's list mode: the
// history can be ~400 rows, which a ScrollView must not try to mount at once.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { eq } from 'drizzle-orm';
import { FlatList, Pressable, Text } from 'react-native';
import { Sheet } from './components';
import { SearchField } from './SearchField';
import { useTheme } from './theme';
import { rankCandidates } from '../suggest/rank';
import type { MerchantHistory } from '../lookup/merchantLookup';
import { normkey } from '../lookup/normkey';
import { PAYEE } from '../lookup/aliases';
import { aliases } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';

export function PayeeSheet({
  visible,
  onClose,
  histories,
  onSelect,
  onCreateNew,
  payeeLabel,
}: {
  visible: boolean;
  onClose: () => void;
  histories: MerchantHistory[];
  onSelect: (history: MerchantHistory) => void;
  onCreateNew: (rawText: string) => void;
  payeeLabel: 'payee' | 'payer'; // matches the screen's transaction type
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const db = useDb();
  const [query, setQuery] = useState('');
  const { data: payeeAliases } = useLiveQuery(
    db.select().from(aliases).where(eq(aliases.kind, PAYEE)),
  );

  const byKey = useMemo(() => new Map(histories.map((h) => [h.merchantKey, h])), [histories]);
  // Typing an alias ("zab", a bank's legal name) finds the payee it maps to, listed first with
  // the alias it came through. A target with no history yet still appears, by name.
  const aliasHits = useMemo(() => {
    const key = normkey(query);
    if (!key) return [];
    const hits = new Map<string, { history: MerchantHistory; via: string }>();
    for (const alias of payeeAliases ?? []) {
      if (!alias.normalizedKey.includes(key)) continue;
      const targetKey = normkey(alias.targetName);
      if (hits.has(targetKey)) continue;
      const history = byKey.get(targetKey) ?? {
        merchantKey: targetKey,
        displayName: alias.targetName,
        topCategory: null,
        topAccountName: null,
        topBudgetName: null,
        occurrences: 0,
        lastUsed: '',
      };
      hits.set(targetKey, { history, via: alias.rawInput });
    }
    return [...hits.values()];
  }, [payeeAliases, byKey, query]);
  const results = useMemo(() => {
    const ranked = rankCandidates(histories, { merchantQuery: query || undefined });
    const viaAlias = new Set(aliasHits.map((h) => h.history.merchantKey));
    return [
      ...aliasHits.map((h) => ({ history: h.history, via: h.via as string | null })),
      ...ranked
        .map((c) => byKey.get(c.merchantKey))
        .filter((h): h is MerchantHistory => !!h && !viaAlias.has(h.merchantKey))
        .map((history) => ({ history, via: null as string | null })),
    ];
  }, [histories, byKey, query, aliasHits]);

  const trimmed = query.trim();

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        setQuery('');
        onClose();
      }}
      title={tr(`payeeSheet.${payeeLabel}.choose`)}
      scroll={false}
      footer={
        !!trimmed && (
          <Pressable
            onPress={() => {
              onCreateNew(trimmed);
              setQuery('');
              onClose();
            }}
            accessibilityRole="button"
            style={({ pressed }) => ({
              paddingVertical: t.space.md,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[t.type.body, { color: t.color.accent, fontWeight: '600' }]}>
              {tr(`payeeSheet.${payeeLabel}.createNew`, { name: trimmed })}
            </Text>
          </Pressable>
        )
      }
    >
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={tr(`payeeSheet.${payeeLabel}.search`)}
        autoFocus
        style={{ marginBottom: t.space.sm }}
      />
      <FlatList
        data={results}
        keyExtractor={(r) => r.history.merchantKey}
        style={{ flex: 1 }}
        // Keeps the right-aligned column clear of Android's scrollbar, which draws over the content.
        contentContainerStyle={{ paddingRight: t.space.md }}
        renderItem={({ item: { history: item, via } }) => (
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
              {item.displayName}
            </Text>
            <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
              {[
                via && tr('payeeSheet.viaAlias', { alias: via }),
                item.topCategory,
                item.topAccountName,
              ]
                .filter(Boolean)
                .join(' · ') || `${item.occurrences}×`}
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
