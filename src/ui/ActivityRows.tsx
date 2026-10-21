// Activity's rows (design §6.4): one transaction's row, the account cards above the list, and a
// day's header. All memoized — a filter tap or a sync used to redraw every one of them.
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { appLocale } from '../i18n';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { usePopOnChange } from './feedback';
import { useTheme } from './theme';
import { Card, ListRow, Money, Pill, PRESSED_OPACITY, SectionHeader } from './kit';
import { currencyOf, formatMoney } from '../money/format';
import { categoryColor } from './categoryColor';
import { navigateOnce } from './navigateOnce';
import { PendingDot } from './PendingDot';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';
import type { PendingEditStatus } from '../transactions/pendingEdits';
import {
  REMOTE_SECTION_KEY,
  cachedSplitLines,
  type ActivityItem,
  type Currencies,
  type DisplaySection,
} from '../transactions/activityRows';
import { dayDate, localDay } from '../utils/day';

const PENDING_LABEL_KEYS: Record<PendingEditStatus, string> = {
  queued: 'activity.edited',
  failed: 'activity.notSent',
  conflict: 'inbox.conflict',
};

function dayTitle(key: string): string {
  const now = new Date();
  if (key === localDay(now)) return i18n.t('capture.today').toUpperCase();
  if (key === localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) {
    return i18n.t('capture.yesterday').toUpperCase();
  }
  // Always with the year: scrolling back past January otherwise gave two identical "14 SEP"s.
  return dayDate(key)
    .toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
    .toUpperCase();
}

export const ActivityRow = memo(function ActivityRow({
  item,
  selecting,
  selected,
  currencies,
  onPress,
  onLongPress,
  isFirst = false,
  isLast = false,
}: {
  item: ActivityItem;
  selecting: boolean;
  selected: boolean;
  currencies: Currencies;
  onPress: (item: ActivityItem) => void;
  onLongPress: (item: ActivityItem) => void;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const queued = 'queued' in item;
  // A remote-search row isn't cached locally yet, so there's nothing for the detail screen
  // (which only reads cachedTransactions) to open.
  const remote = 'remote' in item;
  const pendingStatus = !queued && !remote ? item.pendingStatus : undefined;
  const description =
    item.description ||
    (item.type === 'withdrawal' ? item.destinationName : item.sourceName) ||
    '—';
  const accountLeg = item.type === 'deposit' ? item.sourceName : item.destinationName;
  const selectable = !queued && !remote;
  // The mark pops as it toggles, alongside the tick haptic (src/ui/feedback.ts).
  const markPop = usePopOnChange(selected, 1.4);
  const splitLines = queued ? item.splits : remote ? [] : cachedSplitLines(item);
  const currency = currencyOf(currencies, item.currencyCode);

  let subtitle: string;
  if (item.type === 'transfer') {
    subtitle = `${item.sourceName || '—'} → ${item.destinationName || '—'}`;
  } else if (splitLines.length > 0) {
    const cats = Array.from(
      new Set(splitLines.map((s) => s.categoryName || s.label).filter(Boolean)),
    ).join(', ');
    subtitle = `${tr('splits.count', { count: splitLines.length })} · ${cats || tr('splits.title')}`;
  } else {
    subtitle =
      [item.categoryName, accountLeg].filter(Boolean).join(' · ') ||
      (queued ? tr('draft.queued') : '—');
  }

  const leading =
    selecting && selectable ? (
      <Animated.View style={markPop}>
        {selected ? (
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: t.color.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="checkmark" size={16} color={t.color.onAccent} />
          </View>
        ) : (
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              borderWidth: 1.5,
              borderColor: t.dark ? t.color.border : t.color.borderStrong,
            }}
          />
        )}
      </Animated.View>
    ) : (
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          backgroundColor:
            item.type === 'deposit'
              ? t.color.incomeSoft
              : item.type === 'transfer'
                ? t.color.transferSoft
                : item.categoryName
                  ? categoryColor(item.categoryName, t.dark) + '22'
                  : t.color.neutralSoft,
        }}
      >
        {item.type === 'deposit' ? (
          <Ionicons name="arrow-up" size={14} color={t.color.income} />
        ) : item.type === 'transfer' ? (
          <Ionicons name="swap-horizontal" size={14} color={t.color.transfer} />
        ) : (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: item.categoryName
                ? categoryColor(item.categoryName, t.dark)
                : t.color.textFaint,
            }}
          />
        )}
      </View>
    );

  const tone =
    queued || pendingStatus === 'failed' || pendingStatus === 'conflict' ? 'warn' : 'accent';
  const tagLabel = queued ? tr('draft.queued') : tr(PENDING_LABEL_KEYS[pendingStatus!]);

  const trailing = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
      {((queued && !item.landing) || !!pendingStatus) && (
        <Pill size="sm" tone={tone} label={tagLabel.toUpperCase()} />
      )}
      <Money amount={item.amount} currency={currency} type={item.type} />
    </View>
  );

  return (
    <ListRow
      label={description}
      sub={subtitle}
      leading={leading}
      trailing={trailing}
      onPress={() => onPress(item)}
      onLongPress={selectable ? () => onLongPress(item) : undefined}
      delayLongPress={300}
      first={isFirst}
      selected={selected}
      style={{
        marginHorizontal: t.space.lg,
        backgroundColor: selected ? t.color.accentSoft : t.color.surface,
        ...(isFirst
          ? { borderTopLeftRadius: 14, borderTopRightRadius: 14, borderTopWidth: 1 }
          : null),
        ...(isLast
          ? { borderBottomLeftRadius: 14, borderBottomRightRadius: 14, borderBottomWidth: 1 }
          : null),
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: t.color.border,
      }}
    />
  );
});

let savedBalanceScrollX = 0;

/**
 * The balance cards above the list. Memoized, as is each cell.
 */
export const BalanceStrip = memo(function BalanceStrip({
  accounts,
  selectedId,
  onToggle,
  currencies,
  pendingAccounts,
}: {
  accounts: ReferenceAccountRow[];
  selectedId: string | null;
  onToggle: (id: string) => void;
  currencies: Currencies;
  pendingAccounts: Set<string>;
}) {
  const t = useTheme();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (savedBalanceScrollX > 0) {
      scrollRef.current?.scrollTo({ x: savedBalanceScrollX, animated: false });
    }
  }, []);

  return (
    <View style={{ paddingHorizontal: t.space.lg, paddingTop: 10, paddingBottom: t.space.xs }}>
      <Card flush style={{ overflow: 'hidden' }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: savedBalanceScrollX, y: 0 }}
          onScroll={(e) => {
            savedBalanceScrollX = e.nativeEvent.contentOffset.x;
          }}
          scrollEventThrottle={16}
          style={{ flexGrow: 0, flexShrink: 0 }}
        >
          {accounts.map((a, index) => (
            <BalanceCell
              key={a.id}
              account={a}
              isFirst={index === 0}
              selected={selectedId === a.id}
              pending={pendingAccounts.has(a.id)}
              currencies={currencies}
              onToggle={onToggle}
            />
          ))}
        </ScrollView>
      </Card>
    </View>
  );
});

const BalanceCell = memo(function BalanceCell({
  account: a,
  isFirst,
  selected,
  pending,
  currencies,
  onToggle,
  onLongPress,
}: {
  account: ReferenceAccountRow;
  isFirst: boolean;
  selected: boolean;
  pending: boolean;
  currencies: Currencies;
  onToggle: (id: string) => void;
  onLongPress?: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const currency = currencyOf(currencies, a.currencyCode);

  return (
    <Pressable
      onPress={() => onToggle(a.id)}
      onLongPress={onLongPress ?? (() => navigateOnce(`/accounts/${a.id}`))}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityHint={tr('account.openHint')}
      style={({ pressed }) => ({
        width: 132,
        paddingVertical: 12,
        paddingHorizontal: 14,
        gap: 2,
        borderLeftWidth: isFirst ? 0 : 1,
        borderLeftColor: t.color.border,
        backgroundColor: selected ? t.color.accentSoft : 'transparent',
        borderBottomWidth: selected ? 3 : 0,
        borderBottomColor: t.color.accent,
        opacity: pressed ? PRESSED_OPACITY : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text
          style={[
            t.type.label,
            {
              color: selected ? t.color.accentStrong : t.color.textMuted,
              fontWeight: selected ? '600' : '400',
              flexShrink: 1,
            },
          ]}
          numberOfLines={1}
        >
          {a.name}
        </Text>
        <PendingDot visible={pending} />
      </View>
      <Text
        style={[
          t.type.body,
          t.type.money,
          {
            color: t.color.text,
            fontWeight: '600',
          },
        ]}
        numberOfLines={1}
      >
        {formatMoney(a.currentBalance ?? '0', currency)}
      </Text>
    </Pressable>
  );
});

export const DayHeader = memo(function DayHeader({
  sectionKey,
  totals,
  currencies,
}: {
  sectionKey: string;
  totals: DisplaySection['totals'];
  currencies: Currencies;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <SectionHeader
      title={sectionKey === REMOTE_SECTION_KEY ? tr('activity.fromFf3') : dayTitle(sectionKey)}
      action={
        totals.length > 0 ? (
          <Text
            style={[
              t.type.label,
              t.type.money,
              {
                color: t.color.textMuted,
                fontVariant: ['tabular-nums'],
                fontSize: 13,
                fontWeight: '500',
              },
            ]}
          >
            {totals
              .map((tot) => formatMoney(tot.amount, currencyOf(currencies, tot.currencyCode ?? '')))
              .join(' · ')}
          </Text>
        ) : undefined
      }
    />
  );
});
