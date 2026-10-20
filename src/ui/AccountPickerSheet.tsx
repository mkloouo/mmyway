// One search-and-pick sheet for asset accounts, the Choose sheet on top of SearchListSheet (design
// §4): a grouped card of accounts, A–Z with a letter rail, the chosen one checked, and "Suggested"
// first. Every account is already local via fetchAll, so the search over filterAccounts is instant
// and offline.
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { SearchListSheet } from './SearchListSheet';
import { useTheme } from './theme';
import { filterAccounts } from '../accounts/filterAccounts';
import { currencyOf, formatMoney } from '../money/format';
import type { AccountPickerAccount } from '../accounts/useAssetAccounts';

export type { AccountPickerAccount };

export function AccountPickerSheet({
  visible,
  onClose,
  title,
  accounts,
  currencies,
  excludeId,
  suggested,
  selectedId,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  accounts: AccountPickerAccount[];
  currencies: { code: string; symbol: string; decimalPlaces: number }[];
  /** Leaves the chosen source out of a transfer's destination list. */
  excludeId?: string | null;
  /** Listed first under "Suggested". */
  suggested?: AccountPickerAccount[];
  /** The account to mark with a checkmark. */
  selectedId?: string | null;
  onSelect: (account: AccountPickerAccount) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const candidates = excludeId ? accounts.filter((a) => a.id !== excludeId) : accounts;
  const suggestedCandidates = excludeId ? suggested?.filter((a) => a.id !== excludeId) : suggested;

  return (
    <SearchListSheet
      visible={visible}
      onClose={onClose}
      title={title}
      placeholder={tr('pickers.searchAccounts')}
      items={(query) => filterAccounts(candidates, query)}
      keyOf={(item) => item.id}
      labelOf={(a) => a.name}
      suggested={suggestedCandidates}
      selectedKey={selectedId}
      onSelect={onSelect}
      renderRow={(item) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
          <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>
            {item.name}
          </Text>
          {item.currentBalance != null && (
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {formatMoney(item.currentBalance, currencyOf(currencies, item.currencyCode))}
            </Text>
          )}
        </View>
      )}
    />
  );
}
