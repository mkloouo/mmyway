import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Card, ListRow } from '../kit';
import { useTheme } from '../theme';
import { currencyOf, currencySymbol, formatMoney, fxCaption } from '../../money/format';
import type { CurrencyRow } from '../../money/currencies';

export interface DraftFxRowProps {
  showFx: boolean;
  readOnly?: boolean;
  isSplit?: boolean;
  accountName?: string;
  accountCurrencyCode: string | null | undefined;
  entryCurrencyCode: string;
  foreignAmount?: string;
  impliedRate: string | null;
  currencies: CurrencyRow[];
  onPress: () => void;
}

export function DraftFxRow({
  showFx,
  readOnly,
  isSplit,
  accountName,
  accountCurrencyCode,
  entryCurrencyCode,
  foreignAmount,
  impliedRate,
  currencies,
  onPress,
}: DraftFxRowProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  if (!showFx) return null;

  const defaultLabel = tr(isSplit ? 'draft.accountChargedTotal' : 'draft.accountCharged');
  const label = accountName ? tr('capture.accountPaid', { account: accountName }) : defaultLabel;
  const value = foreignAmount
    ? formatMoney(foreignAmount, currencyOf(currencies, accountCurrencyCode ?? ''))
    : tr('draft.enterAmount');

  return (
    <Card flush style={{ marginHorizontal: t.space.lg }}>
      <ListRow
        first
        label={label}
        value={value}
        tone={foreignAmount ? 'default' : 'warn'}
        check={!foreignAmount}
        chevron={!readOnly}
        onPress={readOnly ? undefined : onPress}
      />
      {!!foreignAmount && !!impliedRate && impliedRate !== '0' && (
        <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.sm }}>
          <Text style={[t.type.caption, { color: t.color.textMuted }]}>
            {fxCaption(
              currencySymbol(accountCurrencyCode, currencies),
              currencySymbol(entryCurrencyCode, currencies),
              impliedRate,
            )}
          </Text>
        </View>
      )}
    </Card>
  );
}
