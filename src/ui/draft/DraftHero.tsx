import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Chip, Money } from '../kit';
import { useTheme } from '../theme';
import type { DisplayCurrency } from '../../money/format';

export interface DraftHeroProps {
  amount: string;
  currency: DisplayCurrency;
  type: 'withdrawal' | 'deposit' | 'transfer';
  description: string;
  currenciesLoading?: boolean;
  amountTone?: 'default' | 'warn';
  aliasCaption?: string | null;
  isNewPayee?: boolean;
  readOnly?: boolean;
  onAmountPress: () => void;
  onDescriptionPress: () => void;
}

export function DraftHero({
  amount,
  currency,
  type,
  description,
  currenciesLoading,
  amountTone = 'default',
  aliasCaption,
  isNewPayee,
  readOnly,
  onAmountPress,
  onDescriptionPress,
}: DraftHeroProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <View
      style={{
        alignItems: 'center',
        paddingTop: t.space.sm,
        paddingBottom: t.space.md,
        paddingHorizontal: t.space.xl,
      }}
    >
      <Pressable onPress={onAmountPress} disabled={readOnly}>
        <Money
          amount={amount}
          currency={currency}
          type={type}
          size="title"
          loading={currenciesLoading}
          tone={amountTone}
        />
      </Pressable>
      <Pressable
        onPress={onDescriptionPress}
        disabled={readOnly}
        accessibilityRole="button"
        accessibilityLabel={tr('fields.description')}
      >
        <Text
          style={[
            t.type.heading,
            {
              color: description ? t.color.text : t.color.textFaint,
              marginTop: t.space.xs,
              textAlign: 'center',
            },
          ]}
          numberOfLines={2}
        >
          {description || tr('fields.description')}
        </Text>
      </Pressable>
      {!!aliasCaption && (
        <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>
          {aliasCaption}
        </Text>
      )}
      {isNewPayee && type !== 'transfer' && (
        <View style={{ marginTop: t.space.sm }}>
          <Chip label={`⚑ ${tr('draft.newPayeeWillBeCreated')}`} tone="warn" />
        </View>
      )}
    </View>
  );
}

export interface DraftSplitHeroProps {
  total: string;
  currency: DisplayCurrency;
  type: 'withdrawal' | 'deposit' | 'transfer';
  title: string;
  currenciesLoading?: boolean;
  readOnly?: boolean;
  onTotalPress: () => void;
  onTitlePress: () => void;
}

export function DraftSplitHero({
  total,
  currency,
  type,
  title,
  currenciesLoading,
  readOnly,
  onTotalPress,
  onTitlePress,
}: DraftSplitHeroProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <View
      style={{
        alignItems: 'center',
        gap: 2,
        paddingHorizontal: t.space.xl,
      }}
    >
      <Text style={[t.type.caption, { color: t.color.textMuted }]}>{tr('splits.total')}</Text>
      <Pressable onPress={onTotalPress} disabled={readOnly}>
        <Money
          amount={total}
          currency={currency}
          type={type}
          size="title"
          loading={currenciesLoading}
        />
      </Pressable>
      <Pressable
        onPress={onTitlePress}
        disabled={readOnly}
        accessibilityRole="button"
        accessibilityLabel={tr('splits.title')}
      >
        <Text
          style={[t.type.heading, { color: t.color.text, textAlign: 'center' }]}
          numberOfLines={2}
        >
          {title}
        </Text>
      </Pressable>
    </View>
  );
}
