// Search + live re-rank over merchant history (design §6.2), the Choose sheet on SearchListSheet: with
// no query it lists the top-ranked payees under "Suggested", then every payee A–Z with a letter rail;
// with a query, the re-ranked matches. The history can be ~400 rows, so it is a SectionList, never a
// ScrollView that mounts them all at once.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { SearchListSheet, UseNewFooter } from './SearchListSheet';
import { useTheme } from './theme';
import { rankCandidates } from '../suggest/rank';
import type { MerchantHistory } from '../lookup/merchantLookup';

interface PayeeRow {
  history: MerchantHistory;
}

function rowsFor(
  byKey: Map<string, MerchantHistory>,
  ranked: { merchantKey: string }[],
): PayeeRow[] {
  return ranked
    .map((c) => byKey.get(c.merchantKey))
    .filter((h): h is MerchantHistory => !!h)
    .map((history) => ({ history }));
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

  const byKey = useMemo(() => new Map(histories.map((h) => [h.merchantKey, h])), [histories]);

  function rows(query: string): PayeeRow[] {
    return rowsFor(byKey, rankCandidates(histories, { merchantQuery: query || undefined }));
  }

  const suggested = useMemo(
    () => rowsFor(byKey, rankCandidates(histories, {}).slice(0, 5)),
    [histories, byKey],
  );

  return (
    <SearchListSheet
      visible={visible}
      onClose={onClose}
      title={tr(`payeeSheet.${payeeLabel}.choose`)}
      placeholder={tr(`payeeSheet.${payeeLabel}.search`)}
      items={rows}
      keyOf={(r) => r.history.merchantKey}
      labelOf={(r) => r.history.displayName}
      suggested={suggested}
      onSelect={(r) => onSelect(r.history)}
      renderRow={({ history }) => (
        <>
          <Text style={[t.type.body, { color: t.color.text }]} numberOfLines={1}>
            {history.displayName}
          </Text>
          <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
            {[history.topCategory, history.topAccountName].filter(Boolean).join(' · ') ||
              `${history.occurrences}×`}
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
