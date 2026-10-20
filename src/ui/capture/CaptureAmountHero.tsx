import { useTranslation } from 'react-i18next';
import { Animated, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '../theme';
import { formatAmountInput, type DisplayCurrency } from '../../money/format';
import { Pill } from './CaptureRows';

export interface CaptureAmountHeroProps {
  short: boolean;
  amountType: StyleProp<TextStyle>;
  amount: string;
  currency: DisplayCurrency;
  fieldStyle: StyleProp<TextStyle>;
  ghost: { key: number; text: string } | null;
  ghostStyle: StyleProp<TextStyle>;
  effectiveCurrencyCode: string | null;
  dateText: string;
  moreHasValue: boolean;
  aliasCaption: string | null;
  onOpenCurrency: () => void;
  onOpenDate: () => void;
  onOpenDetails: () => void;
}

export function CaptureAmountHero({
  short,
  amountType,
  amount,
  currency,
  fieldStyle,
  ghost,
  ghostStyle,
  effectiveCurrencyCode,
  dateText,
  moreHasValue,
  aliasCaption,
  onOpenCurrency,
  onOpenDate,
  onOpenDetails,
}: CaptureAmountHeroProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <View style={{ alignItems: 'center', paddingVertical: short ? t.space.sm : t.space.lg }}>
      <View style={{ alignSelf: 'stretch', alignItems: 'center' }}>
        <Animated.Text
          style={[amountType, t.type.money, { color: t.color.text }, fieldStyle]}
          numberOfLines={1}
        >
          {formatAmountInput(amount, currency)}
        </Animated.Text>
        {!!ghost && (
          <Animated.Text
            key={ghost.key}
            pointerEvents="none"
            style={[
              amountType,
              t.type.money,
              {
                color: t.color.accent,
                position: 'absolute',
                left: 0,
                right: 0,
                textAlign: 'center',
              },
              ghostStyle,
            ]}
            numberOfLines={1}
          >
            {ghost.text}
          </Animated.Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: t.space.sm }}>
        <Pill
          label={effectiveCurrencyCode ?? '—'}
          caret
          accessibilityLabel={tr('capture.changeCurrency')}
          onPress={onOpenCurrency}
        />
        <Pill label={dateText} caret accessibilityLabel={tr('fields.date')} onPress={onOpenDate} />
        <Pill label={tr('capture.details')} dot={moreHasValue} onPress={onOpenDetails} />
      </View>
      {!!aliasCaption && (
        <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>
          {aliasCaption}
        </Text>
      )}
    </View>
  );
}
