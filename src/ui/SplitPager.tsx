// A split transaction on screen: the tracked total on top (tap to change it), a leftover banner
// while the splits don't add up to it, and one page per split, swiped through horizontally.
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Button, Money } from './components';
import { useTheme } from './theme';
import { formatMoney, type DisplayCurrency } from './money';
import { fromMinor } from '../splits/allocate';

export function SplitPager({
  total,
  count,
  index,
  onIndexChange,
  currency,
  type,
  leftover,
  onTotalPress,
  onReassign,
  readOnly,
  renderPage,
}: {
  total: string;
  count: number;
  index: number;
  onIndexChange: (index: number) => void;
  currency: DisplayCurrency;
  type: 'withdrawal' | 'deposit' | 'transfer';
  /** Total minus the splits' sum, in minor units. */
  leftover: bigint;
  onTotalPress: () => void;
  onReassign: () => void;
  readOnly?: boolean;
  renderPage: (index: number) => ReactNode;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);

  // Follows a page the screen picked (a new split, a removed one, a dot tapped); after a swipe
  // the pager is already there and this is a no-op.
  useEffect(() => {
    scroller.current?.scrollTo({ x: index * width, animated: true });
  }, [index, width]);

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const page = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (page !== index) onIndexChange(page);
  }

  return (
    <View style={{ gap: t.space.md }}>
      <View style={{ alignItems: 'center', gap: t.space.xs }}>
        <Text style={[t.type.caption, { color: t.color.textMuted, textTransform: 'uppercase' }]}>
          {tr('splits.total')}
        </Text>
        <Pressable
          onPress={onTotalPress}
          disabled={readOnly}
          accessibilityRole="button"
          accessibilityLabel={tr('splits.editTotal')}
        >
          <Money amount={total} currency={currency} type={type} size="title" />
        </Pressable>
      </View>
      {leftover !== 0n && (
        <View
          style={{
            marginHorizontal: t.space.lg,
            padding: t.space.md,
            borderRadius: t.radius.sm,
            backgroundColor: t.color.warnSoft,
            gap: t.space.sm,
          }}
        >
          <Text style={[t.type.label, { color: t.color.warn }]}>
            {leftover > 0n
              ? tr('splits.leftoverUnassigned', {
                  amount: formatMoney(fromMinor(leftover, currency.decimalPlaces), currency),
                })
              : tr('splits.leftoverOver', {
                  amount: formatMoney(fromMinor(-leftover, currency.decimalPlaces), currency),
                })}
          </Text>
          {!readOnly && (
            <Button title={tr('splits.reassign')} variant="secondary" onPress={onReassign} />
          )}
        </View>
      )}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: t.space.sm,
        }}
      >
        <Text style={[t.type.label, { color: t.color.textMuted }]}>
          {tr('splits.position', { index: index + 1, count })}
        </Text>
        {Array.from({ length: count }, (_, i) => (
          <Pressable
            key={i}
            onPress={() => onIndexChange(i)}
            hitSlop={6}
            accessibilityLabel={tr('splits.position', { index: i + 1, count })}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === index ? t.color.accent : t.color.border,
              }}
            />
          </Pressable>
        ))}
      </View>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        contentOffset={{ x: index * width, y: 0 }}
      >
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={{ width, gap: t.space.md }}>
            {renderPage(i)}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
