// One envelope row in the Budget tab (Board 01).
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { divideDecimal } from '../api/ff3/decimal';
import type { Envelope } from '../bucket/envelopes';
import { formatMoney, type DisplayCurrency } from '../money/format';
import { PendingDot } from '../ui/PendingDot';
import { Money, ProgressBar } from '../ui/kit';
import { useTheme } from '../ui/theme';

export function spentFraction(envelope: Envelope): number {
  if (envelope.overspent) return 1;
  const spent = envelope.spent.replace(/^[-−]/, '');
  if (!envelope.assigned || envelope.assigned === '0' || envelope.assigned === '0.00') {
    return spent !== '0' && spent !== '0.00' ? 1 : 0;
  }
  return Math.min(1, Number(divideDecimal(spent, envelope.assigned, 4)));
}

export function EnvelopeRow({
  envelope,
  currency,
  pending,
  first,
  onPress,
  onCover,
}: {
  envelope: Envelope;
  currency: DisplayCurrency;
  pending?: boolean;
  first?: boolean;
  onPress: () => void;
  onCover?: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  const unsigned = (amount: string) => formatMoney(amount.replace(/^[-−]/, ''), currency);

  const isAssignedZero =
    !envelope.assigned || envelope.assigned === '0' || envelope.assigned === '0.00';
  const isSpentZero =
    !envelope.spent ||
    envelope.spent === '0' ||
    envelope.spent === '0.00' ||
    envelope.spent === '-0.00';

  let subText: string;
  if (envelope.overspent) {
    subText = isAssignedZero
      ? tr('budget.spentNothingAssigned', { spent: unsigned(envelope.spent) })
      : tr('budget.spentOfAssigned', {
          spent: unsigned(envelope.spent),
          assigned: unsigned(envelope.assigned),
        });
  } else if (isAssignedZero && isSpentZero) {
    subText = tr('budget.nothingAssigned');
  } else {
    subText = tr('budget.spentOfAssigned', {
      spent: unsigned(envelope.spent),
      assigned: unsigned(envelope.assigned),
    });
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${envelope.name}, ${unsigned(envelope.available)}`}
      style={({ pressed }) => ({
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.md,
        gap: 7,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {!first && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: t.space.lg,
            right: 0,
            height: 1,
            backgroundColor: t.color.border,
          }}
        />
      )}

      {/* Top line: Name + Amount */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: t.space.sm,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs, flex: 1 }}>
          <PendingDot visible={Boolean(pending)} />
          <Text
            style={[t.type.body, { color: t.color.text, fontWeight: '600', flex: 1 }]}
            numberOfLines={1}
          >
            {envelope.name}
          </Text>
        </View>
        <Money
          amount={envelope.available}
          currency={currency}
          size="heading"
          tone={envelope.overspent ? 'warn' : undefined}
        />
      </View>

      {/* Middle line: Progress bar */}
      <ProgressBar
        progress={spentFraction(envelope)}
        tone={envelope.overspent ? 'warn' : 'accent'}
        height={6}
      />

      {/* Bottom line: Subtitle + Cover action */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: t.space.sm,
        }}
      >
        <Text style={[t.type.caption, { color: t.color.textMuted, flex: 1 }]} numberOfLines={1}>
          {subText}
        </Text>
        {envelope.overspent && onCover && (
          <Pressable
            onPress={onCover}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={tr('budget.coverRow', { amount: unsigned(envelope.available) })}
          >
            <Text style={[t.type.caption, { color: t.color.warn, fontWeight: '600' }]}>
              {tr('budget.cover')}
            </Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}
