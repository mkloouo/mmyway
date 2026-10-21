import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { useTheme } from './theme';

export interface ActivityListFooterProps {
  reachedRealEnd: boolean;
  loadingMore: boolean;
  loadingOlder: boolean;
  searchFooter: { key: string; warn?: boolean } | null;
}

export const ActivityListFooter = memo(function ActivityListFooter({
  reachedRealEnd,
  loadingMore,
  loadingOlder,
  searchFooter,
}: ActivityListFooterProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <>
      {!reachedRealEnd && (
        <Text
          style={[
            t.type.label,
            {
              color: t.color.textFaint,
              textAlign: 'center',
              paddingVertical: t.space.lg,
            },
          ]}
        >
          {loadingMore || loadingOlder ? tr('activity.loadingMore') : ' '}
        </Text>
      )}
      {searchFooter && (
        <Text
          style={[
            t.type.label,
            {
              color: searchFooter.warn ? t.color.warn : t.color.textFaint,
              textAlign: 'center',
              paddingVertical: t.space.lg,
            },
          ]}
        >
          {tr(searchFooter.key)}
        </Text>
      )}
    </>
  );
});
