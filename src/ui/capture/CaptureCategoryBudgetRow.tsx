import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { Dot, PRESSED_OPACITY } from '../kit';
import { categoryColor } from '../categoryColor';
import { isNegative } from '../../api/ff3/decimal';
import { formatMoney, type DisplayCurrency } from '../../money/format';

export interface CaptureCategoryBudgetRowProps {
  categoryName: string | null;
  budget: { id: string; name: string } | undefined;
  envelopesOn: boolean;
  envelopeLeft: string | null;
  currency: DisplayCurrency;
  onOpenCategory: () => void;
  onOpenBudget: () => void;
}

export function CaptureCategoryBudgetRow({
  categoryName,
  budget,
  envelopesOn,
  envelopeLeft,
  currency,
  onOpenCategory,
  onOpenBudget,
}: CaptureCategoryBudgetRowProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <View
      style={{
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: t.color.border,
      }}
    >
      <Pressable
        onPress={onOpenCategory}
        accessibilityRole="button"
        accessibilityLabel={tr('fields.category')}
        testID="capture-category"
        style={({ pressed }) => ({
          flex: 1,
          paddingLeft: t.space.lg,
          paddingRight: t.space.md,
          paddingVertical: t.space.sm,
          justifyContent: 'center',
          opacity: pressed ? PRESSED_OPACITY : 1,
        })}
      >
        <Text
          numberOfLines={1}
          style={[t.type.caption, { color: t.color.textFaint, marginBottom: t.space.xs }]}
        >
          {tr('fields.category')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
          {categoryName && <Dot color={categoryColor(categoryName, t.dark)} size={8} />}
          <Text
            numberOfLines={1}
            style={[t.type.body, { color: categoryName ? t.color.text : t.color.textMuted }]}
          >
            {categoryName ?? tr('common.none')}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onOpenBudget}
        accessibilityRole="button"
        accessibilityLabel={tr('fields.budget')}
        testID="capture-budget"
        style={({ pressed }) => ({
          flex: 1,
          borderLeftWidth: 1,
          borderLeftColor: t.color.border,
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.sm,
          justifyContent: 'center',
          opacity: pressed ? PRESSED_OPACITY : 1,
        })}
      >
        <Text
          numberOfLines={1}
          style={[t.type.caption, { color: t.color.textFaint, marginBottom: t.space.xs }]}
        >
          {tr('fields.budget')}
        </Text>
        <Text numberOfLines={1} style={t.type.body}>
          <Text style={{ color: budget ? t.color.text : t.color.textMuted }}>
            {budget?.name ?? tr('common.none')}
          </Text>
          {!!budget && envelopesOn && envelopeLeft !== null && (
            <Text
              style={[
                t.type.label,
                { color: isNegative(envelopeLeft) ? t.color.warn : t.color.textMuted },
              ]}
            >
              {' · '}
              {formatMoney(envelopeLeft.replace(/^[-−]/, ''), currency)}{' '}
              {isNegative(envelopeLeft) ? tr('capture.overShort') : tr('capture.leftShort')}
            </Text>
          )}
        </Text>
      </Pressable>
    </View>
  );
}
