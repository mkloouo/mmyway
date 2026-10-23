// Month switcher row under TabHeader in the Budget tab (Board 01).
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { IconButton } from '../ui/kit';
import { useTheme } from '../ui/theme';

export function BudgetMonthSwitcher({
  monthLabel,
  onPrevious,
  onNext,
  isFutureLimit,
}: {
  monthLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  isFutureLimit: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.xs,
        paddingHorizontal: t.space.md,
        paddingTop: t.space.xs,
        paddingBottom: t.space.sm,
      }}
    >
      <IconButton
        icon="chevron-back"
        size={20}
        label={tr('budget.previousMonth')}
        onPress={onPrevious}
      />
      <Text style={[t.type.body, { fontWeight: '600', color: t.color.text }]}>{monthLabel}</Text>
      <IconButton
        icon="chevron-forward"
        size={20}
        label={tr('budget.nextMonth')}
        disabled={isFutureLimit}
        onPress={onNext}
      />
    </View>
  );
}
