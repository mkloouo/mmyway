// One page of a split: its amount, description and payee on top, the caller's detail rows under
// them, and Remove at the bottom. The draft screen and the transaction screen draw the same page;
// they differ only in what a tap writes, which is why each hands its own handlers in.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Button, Chip, Money } from './components';
import { useTheme } from './theme';
import type { DisplayCurrency } from './money';

export function SplitPage({
  amount,
  currency,
  type,
  description,
  payee,
  isNewPayee,
  readOnly,
  onAmountPress,
  onDescriptionPress,
  onPayeePress,
  onRemove,
  children,
}: {
  amount: string;
  currency: DisplayCurrency;
  type: 'withdrawal' | 'deposit' | 'transfer';
  description: string | null | undefined;
  payee: string | null | undefined;
  isNewPayee?: boolean;
  readOnly?: boolean;
  onAmountPress: () => void;
  onDescriptionPress: () => void;
  onPayeePress: () => void;
  /** Given only when this page can be removed — a transaction with one split can't. */
  onRemove?: () => void;
  /** The page's detail rows. */
  children: ReactNode;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <>
      <View style={{ alignItems: 'center', paddingHorizontal: t.space.xl, gap: t.space.xs }}>
        <Pressable
          onPress={onAmountPress}
          disabled={readOnly}
          accessibilityRole="button"
          accessibilityLabel={tr('fields.amount')}
        >
          <Money amount={amount} currency={currency} type={type} size="heading" />
        </Pressable>
        <Pressable
          onPress={onDescriptionPress}
          disabled={readOnly}
          accessibilityRole="button"
          accessibilityLabel={tr('fields.description')}
        >
          <Text
            style={[t.type.body, { color: t.color.text, textAlign: 'center' }]}
            numberOfLines={2}
          >
            {description || '—'}
          </Text>
        </Pressable>
        {type !== 'transfer' && (
          <Pressable
            onPress={onPayeePress}
            disabled={readOnly}
            accessibilityRole="button"
            accessibilityLabel={type === 'deposit' ? tr('capture.payer') : tr('capture.payee')}
          >
            <Text style={[t.type.label, { color: t.color.accent }]}>{payee || '—'}</Text>
          </Pressable>
        )}
        {isNewPayee && type !== 'transfer' && (
          <Chip label={`⚑ ${tr('draft.newPayeeWillBeCreated')}`} tone="warn" />
        )}
      </View>
      {children}
      {!!onRemove && !readOnly && (
        <View style={{ paddingHorizontal: t.space.lg }}>
          <Button title={tr('splits.remove')} variant="danger" onPress={onRemove} />
        </View>
      )}
    </>
  );
}
