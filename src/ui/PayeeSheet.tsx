// Search + live re-rank over merchant history (design §6.2). Uses SearchListSheet's list mode: the
// history can be ~400 rows, which a ScrollView must not try to mount at once.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { eq } from 'drizzle-orm';
import { Text } from 'react-native';
import { SearchListSheet, UseNewFooter } from './SearchListSheet';
import { useTheme } from './theme';
import { rankCandidates } from '../suggest/rank';
import type { MerchantHistory } from '../lookup/merchantLookup';
import { normkey } from '../lookup/normkey';
import { PAYEE } from '../lookup/aliases';
import { aliases } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';

interface PayeeRow {
  history: MerchantHistory;
  /** The alias the row was found through, if the query matched one. */
  via: string | null;
}

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
  const { data: payeeAliases } = useLiveQuery(
    db.select().from(aliases).where(eq(aliases.kind, PAYEE)),
    [],
    visible,
  );

  const byKey = useMemo(() => new Map(histories.map((h) => [h.merchantKey, h])), [histories]);

  // Typing an alias ("zab", a bank's legal name) finds the payee it maps to, listed first with
  // the alias it came through. A target with no history yet still appears, by name.
  function aliasHits(query: string): PayeeRow[] {
    const key = normkey(query);
    if (!key) return [];
    const hits = new Map<string, PayeeRow>();
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
  }

  function rows(query: string): PayeeRow[] {
    const hits = aliasHits(query);
    const viaAlias = new Set(hits.map((h) => h.history.merchantKey));
    return [
      ...hits,
      ...rankCandidates(histories, { merchantQuery: query || undefined })
        .map((c) => byKey.get(c.merchantKey))
        .filter((h): h is MerchantHistory => !!h && !viaAlias.has(h.merchantKey))
        .map((history) => ({ history, via: null })),
    ];
  }

  return (
    <SearchListSheet
      visible={visible}
      onClose={onClose}
      title={tr(`payeeSheet.${payeeLabel}.choose`)}
      placeholder={tr(`payeeSheet.${payeeLabel}.search`)}
      items={rows}
      keyOf={(r) => r.history.merchantKey}
      onSelect={(r) => onSelect(r.history)}
      renderRow={({ history, via }) => (
        <>
          <Text style={[t.type.body, { color: t.color.text }]} numberOfLines={1}>
            {history.displayName}
          </Text>
          <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
            {[
              via && tr('payeeSheet.viaAlias', { alias: via }),
              history.topCategory,
              history.topAccountName,
            ]
              .filter(Boolean)
              .join(' · ') || `${history.occurrences}×`}
          </Text>
        </>
      )}
      footer={(trimmed, close) =>
        trimmed ? (
          <UseNewFooter
            label={tr(`payeeSheet.${payeeLabel}.createNew`, { name: trimmed })}
            onPress={() => {
              onCreateNew(trimmed);
              close();
            }}
          />
        ) : undefined
      }
    />
  );
}
