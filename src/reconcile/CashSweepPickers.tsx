// One shared account picker sheet for Cash count and Cash settings differences (design board 28).
// Presents "Missing cash goes to" (expense) or "Extra cash comes from" (revenue) as a Choose sheet
// with "Used this year · N | All · N" segmented filter, Chosen account at top, and A–Z letter sections.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { SearchListSheet } from '../ui/SearchListSheet';
import { Segmented } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { filterAccounts } from '../accounts/filterAccounts';
import { currencyOf, formatMoney } from '../money/format';
import type { AccountPickerAccount } from '../accounts/useAssetAccounts';

export type CashSweepPickerKind = 'shortfall' | 'surplus';

export interface CashSweepPickersProps {
  picker: CashSweepPickerKind | null;
  onClose: () => void;
  expenseAccounts: AccountPickerAccount[];
  usedExpenseAccounts: AccountPickerAccount[];
  revenueAccounts: AccountPickerAccount[];
  usedRevenueAccounts: AccountPickerAccount[];
  currencies: { code: string; symbol: string; decimalPlaces: number }[];
  selectedShortfallId?: string | null;
  selectedSurplusId?: string | null;
  onSelectShortfall: (account: AccountPickerAccount) => void;
  onSelectSurplus: (account: AccountPickerAccount) => void;
}

export function CashSweepPickers({
  picker,
  onClose,
  expenseAccounts,
  usedExpenseAccounts,
  revenueAccounts,
  usedRevenueAccounts,
  currencies,
  selectedShortfallId,
  selectedSurplusId,
  onSelectShortfall,
  onSelectSurplus,
}: CashSweepPickersProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  const isShortfall = picker === 'shortfall';
  const allAccounts = isShortfall ? expenseAccounts : revenueAccounts;
  const usedAccounts = isShortfall ? usedExpenseAccounts : usedRevenueAccounts;
  const selectedId = isShortfall ? selectedShortfallId : selectedSurplusId;
  const onSelect = isShortfall ? onSelectShortfall : onSelectSurplus;

  const [activeFilter, setActiveFilter] = useState<'used' | 'all' | null>(null);
  const filter = activeFilter ?? (usedAccounts.length > 0 ? 'used' : 'all');

  const handleClose = () => {
    setActiveFilter(null);
    onClose();
  };

  const handleSelect = (account: AccountPickerAccount) => {
    setActiveFilter(null);
    onSelect(account);
  };

  const candidates = filter === 'used' ? usedAccounts : allAccounts;
  const chosen = allAccounts.find((a) => a.id === selectedId) ?? null;

  const title = isShortfall ? tr('count.missingCashTitle') : tr('count.extraCashTitle');
  const subtitle = isShortfall
    ? tr('count.accountCountExpense', { count: allAccounts.length })
    : tr('count.accountCountRevenue', { count: allAccounts.length });

  const header = (
    <View style={{ marginBottom: t.space.sm }}>
      <Segmented
        accessibilityLabel={tr('count.whichAccounts')}
        value={filter}
        onChange={setActiveFilter}
        options={[
          {
            key: 'used',
            label: tr('count.usedThisYear', { count: usedAccounts.length }),
          },
          {
            key: 'all',
            label: tr('count.allCount', { count: allAccounts.length }),
          },
        ]}
      />
    </View>
  );

  return (
    <SearchListSheet
      visible={picker != null}
      onClose={handleClose}
      title={title}
      subtitle={subtitle}
      placeholder={tr('pickers.searchByName')}
      items={(query) => filterAccounts(candidates, query)}
      keyOf={(item) => item.id}
      labelOf={(a) => a.name}
      chosen={chosen ?? undefined}
      selectedKey={selectedId}
      header={header}
      renderRow={(item) => {
        const isChosen = item.id === selectedId;
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
            <Text
              style={[
                t.type.body,
                { color: t.color.text, flex: 1, fontWeight: isChosen ? '600' : '400' },
              ]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {item.currentBalance != null && (
              <Text style={[t.type.label, { color: t.color.textMuted }]}>
                {formatMoney(item.currentBalance, currencyOf(currencies, item.currencyCode))}
              </Text>
            )}
          </View>
        );
      }}
      onSelect={handleSelect}
    />
  );
}
