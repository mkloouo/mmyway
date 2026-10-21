import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Button, Card, ListRow, SectionHeader, Segmented, Sheet } from './kit';
import { PendingDot } from './PendingDot';
import { useTheme } from './theme';
import { FILTERS } from '../transactions/activityFilters';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';
import type { ActivityTypeFilter } from '../transactions/useTransactionPage';

export const ActivityFilterSheet = memo(function ActivityFilterSheet({
  visible,
  onClose,
  type,
  onChangeType,
  accountFilter,
  onSelectAccount,
  onClearFilters,
  assetAccounts,
  pendingAccounts,
  transactionCount,
}: {
  visible: boolean;
  onClose: () => void;
  type: ActivityTypeFilter;
  onChangeType: (type: ActivityTypeFilter) => void;
  accountFilter: string | null;
  onSelectAccount: (id: string | null) => void;
  onClearFilters: () => void;
  assetAccounts: ReferenceAccountRow[];
  pendingAccounts: Set<string>;
  transactionCount: number;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <Sheet visible={visible} onClose={onClose} title={tr('activity.filters')}>
      <SectionHeader
        title={tr('activity.filterType')}
        first
        style={{ paddingHorizontal: t.space.xs, paddingBottom: t.space.sm }}
      />
      <Segmented<ActivityTypeFilter>
        value={type}
        onChange={onChangeType}
        options={FILTERS.map((f) => ({ key: f.type, label: tr(f.labelKey) }))}
      />

      <SectionHeader
        title={tr('activity.filterAccounts')}
        style={{ paddingHorizontal: t.space.xs, paddingTop: t.space.lg, paddingBottom: t.space.sm }}
      />
      <Card flush>
        <ListRow
          first
          label={tr('activity.allAccounts')}
          icon={accountFilter === null ? 'checkmark' : undefined}
          onPress={() => onSelectAccount(null)}
        />
        {assetAccounts.map((a) => (
          <ListRow
            key={a.id}
            label={a.name}
            leading={pendingAccounts.has(a.id) ? <PendingDot visible /> : undefined}
            icon={accountFilter === a.id ? 'checkmark' : undefined}
            onPress={() => onSelectAccount(accountFilter === a.id ? null : a.id)}
          />
        ))}
      </Card>
      <Text
        style={[
          t.type.label,
          { color: t.color.textMuted, paddingHorizontal: t.space.xs, paddingTop: t.space.xs },
        ]}
      >
        {tr('activity.pendingDotHint')}
      </Text>

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: t.color.border,
          marginTop: t.space.md,
          paddingTop: t.space.md,
          paddingBottom: t.space.sm,
          flexDirection: 'row',
          gap: t.space.sm,
          alignItems: 'center',
        }}
      >
        <Button
          title={tr('common.clear')}
          variant="ghost"
          onPress={onClearFilters}
          style={{ height: 52 }}
        />
        <Button
          title={tr('activity.showTransactions', { count: transactionCount })}
          onPress={onClose}
          style={{ flex: 1, height: 52, borderRadius: 14 }}
        />
      </View>
    </Sheet>
  );
});
