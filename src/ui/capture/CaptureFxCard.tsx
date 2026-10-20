import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Card } from '../kit';
import { useTheme } from '../theme';
import { TextField } from '../TextField';
import { currencySymbol, fxCaption } from '../../money/format';
import { isNegative } from '../../api/ff3/decimal';
import { WarnBar } from './CaptureRows';

export interface CaptureFxCardProps {
  showFx: boolean;
  fxMissing: boolean;
  fxAccountName: string | null;
  foreignAmount: string;
  onChangeForeignAmount: (val: string) => void;
  accountCurrencyCode: string | null;
  effectiveCurrencyCode: string | null;
  currencies: { code: string; symbol: string; decimalPlaces: number }[];
  impliedRate: string | null;
}

export function CaptureFxCard({
  showFx,
  fxMissing,
  fxAccountName,
  foreignAmount,
  onChangeForeignAmount,
  accountCurrencyCode,
  effectiveCurrencyCode,
  currencies,
  impliedRate,
}: CaptureFxCardProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  if (!showFx) return null;

  return (
    <Card flush style={{ marginHorizontal: t.space.lg, marginBottom: t.space.sm }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 48,
          paddingHorizontal: t.space.lg,
          gap: t.space.sm,
        }}
      >
        {fxMissing && <WarnBar />}
        <Text
          numberOfLines={1}
          style={[t.type.label, { color: fxMissing ? t.color.warn : t.color.textFaint }]}
        >
          {tr('capture.accountPaid', { account: fxAccountName })}
        </Text>
        <TextField
          value={foreignAmount}
          onChangeText={onChangeForeignAmount}
          keyboardType="decimal-pad"
          placeholder={`___ ${currencySymbol(accountCurrencyCode, currencies)}`}
          style={[
            t.type.heading,
            {
              flex: 1,
              minWidth: 0,
              borderWidth: 0,
              paddingHorizontal: 0,
              backgroundColor: 'transparent',
              textAlign: 'right',
              fontVariant: ['tabular-nums'],
            },
          ]}
        />
        {!!impliedRate && !isNegative(impliedRate) && (
          <Text numberOfLines={1} style={[t.type.label, { color: t.color.textFaint }]}>
            {fxCaption(
              currencySymbol(accountCurrencyCode, currencies),
              currencySymbol(effectiveCurrencyCode, currencies),
              impliedRate,
            )}
          </Text>
        )}
      </View>
    </Card>
  );
}
