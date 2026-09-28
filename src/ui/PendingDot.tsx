// The yellow dot on an account card whose changes are still waiting to reach Firefly III.
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from './theme';

export function PendingDot({ visible }: { visible: boolean }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  if (!visible) return null;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={tr('account.pendingChanges')}
      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color.warn }}
    />
  );
}
