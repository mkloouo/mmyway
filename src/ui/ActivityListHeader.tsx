import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Chip, SCREEN_TOP_PADDING } from './kit';
import { useTheme } from './theme';
import { BalanceStrip } from './ActivityRows';
import { FILTERS } from '../transactions/activityFilters';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';
import type { Currencies } from '../transactions/activityRows';
import type { ActivityTypeFilter } from '../transactions/useTransactionPage';

export const ActivityListHeader = memo(function ActivityListHeader({
  assetAccounts,
  accountFilter,
  onToggleAccountFilter,
  currencies,
  pendingAccounts,
  type,
  onSelectType,
}: {
  assetAccounts: ReferenceAccountRow[];
  accountFilter: string | null;
  onToggleAccountFilter: (id: string) => void;
  currencies: Currencies;
  pendingAccounts: Set<string>;
  type: ActivityTypeFilter;
  onSelectType: (type: ActivityTypeFilter) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <View style={{ paddingTop: SCREEN_TOP_PADDING - t.space.xs, paddingBottom: t.space.xs }}>
      {assetAccounts.length > 0 && (
        <BalanceStrip
          accounts={assetAccounts}
          selectedId={accountFilter}
          onToggle={onToggleAccountFilter}
          currencies={currencies}
          pendingAccounts={pendingAccounts}
        />
      )}

      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: t.space.lg,
          gap: t.space.sm,
          paddingTop: t.space.xs,
          paddingBottom: t.space.sm,
        }}
      >
        {FILTERS.map((f) => (
          <Chip
            key={f.type}
            label={tr(f.labelKey)}
            selected={type === f.type}
            onPress={() => onSelectType(f.type)}
          />
        ))}
      </View>
    </View>
  );
});
