import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Button, IconButton, TabHeader } from './kit';
import { SearchField } from './SearchField';
import { useTheme } from './theme';

export interface ActivityHeaderProps {
  selecting: boolean;
  selectedCount: number;
  onClearSelection: () => void;
  searchOpen: boolean;
  search: string;
  onChangeSearch: (text: string) => void;
  onCloseSearch: () => void;
  isFiltered: boolean;
  activeFilterSubtitle: string;
  onClearFilters: () => void;
  onOpenSearch: () => void;
  activeFilterCount: number;
  onOpenFilter: () => void;
  onOpenMenu: () => void;
}

export const ActivityHeader = memo(function ActivityHeader({
  selecting,
  selectedCount,
  onClearSelection,
  searchOpen,
  search,
  onChangeSearch,
  onCloseSearch,
  isFiltered,
  activeFilterSubtitle,
  onClearFilters,
  onOpenSearch,
  activeFilterCount,
  onOpenFilter,
  onOpenMenu,
}: ActivityHeaderProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  if (selecting) {
    return (
      <TabHeader
        title={tr('inbox.selected', { count: selectedCount })}
        left={<Button variant="text" title={tr('common.cancel')} onPress={onClearSelection} />}
      />
    );
  }

  if (searchOpen) {
    return (
      <TabHeader>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space.sm,
          }}
        >
          <SearchField
            value={search}
            onChangeText={onChangeSearch}
            placeholder={tr('activity.searchPlaceholder')}
            autoFocus
            style={{ flex: 1 }}
          />
          <Button variant="text" title={tr('common.cancel')} onPress={onCloseSearch} />
        </View>
      </TabHeader>
    );
  }

  return (
    <TabHeader
      title={tr('activity.title')}
      subtitle={
        isFiltered ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
              {activeFilterSubtitle}
            </Text>
            <Button variant="text" title={tr('common.clear')} onPress={onClearFilters} />
          </View>
        ) : undefined
      }
      right={
        <>
          <IconButton icon="search" label={tr('activity.search')} onPress={onOpenSearch} />
          <IconButton
            icon="funnel"
            label={
              activeFilterCount > 0
                ? tr('activity.filterActive', { count: activeFilterCount })
                : tr('activity.filter')
            }
            active={isFiltered}
            onPress={onOpenFilter}
          />
          <IconButton icon="ellipsis-horizontal" label={tr('capture.more')} onPress={onOpenMenu} />
        </>
      }
    />
  );
});
