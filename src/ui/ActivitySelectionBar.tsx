import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from './kit';
import { useTheme } from './theme';

export interface ActivitySelectionBarProps {
  selectedCount: number;
  onDelete: () => void;
}

export const ActivitySelectionBar = memo(function ActivitySelectionBar({
  selectedCount,
  onDelete,
}: ActivitySelectionBarProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        borderTopWidth: 1,
        borderTopColor: t.color.border,
        paddingHorizontal: t.space.lg,
        paddingTop: t.space.md,
        paddingBottom: t.space.xl,
        backgroundColor: t.color.surface,
      }}
    >
      <Button
        title={
          selectedCount > 0
            ? tr('activity.deleteSelected', { count: selectedCount })
            : tr('common.delete')
        }
        variant="dangerSoft"
        disabled={selectedCount === 0}
        onPress={onDelete}
        style={{ height: 52, borderRadius: t.radius.md }}
      />
    </View>
  );
});
