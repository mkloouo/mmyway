// Search + live re-rank over merchant history (design §6.2). Uses SearchListSheet's list mode: the
// history can be ~400 rows, which a ScrollView must not try to mount at once.
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
    return rankCandidates(histories, { merchantQuery: query || undefined })
      .map((c) => byKey.get(c.merchantKey))
      .filter((h): h is MerchantHistory => !!h)
      .map((history) => ({ history }));
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
