// Activity's rows (design §6.4): one transaction's row, the account cards above the list, and a
// day's header. All memoized — a filter tap or a sync used to redraw every one of them.
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { appLocale } from '../i18n';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { usePopOnChange } from './feedback';
import { useTheme } from './theme';
import { Card, Money, PRESSED_OPACITY, SectionHeader } from './kit';
import { currencyOf, formatMoney } from './money';
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
  queued: 'draft.queued',
  failed: 'activity.notSent',
  conflict: 'inbox.conflict',
};

function dayTitle(key: string): string {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === localDay(now)) return i18n.t('capture.today').toUpperCase();
  if (key === localDay(yesterday)) return i18n.t('capture.yesterday').toUpperCase();
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

  return (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={selectable ? () => onLongPress(item) : undefined}
      // 500ms by default, which felt like the long-press hadn't registered.
      delayLongPress={300}
      style={({ pressed }) => ({
        marginHorizontal: t.space.lg,
        backgroundColor: selected ? t.color.accentSoft : t.color.surface,
        borderTopLeftRadius: isFirst ? 14 : 0,
        borderTopRightRadius: isFirst ? 14 : 0,
        borderBottomLeftRadius: isLast ? 14 : 0,
        borderBottomRightRadius: isLast ? 14 : 0,
        borderTopWidth: isFirst ? 1 : 0,
        borderBottomWidth: isLast ? 1 : 0,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: t.color.border,
        minHeight: 52,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        position: 'relative',
        opacity: pressed ? PRESSED_OPACITY : 1,
      })}
    >
      {selecting && selectable ? (
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
      )}

      <View style={{ flex: 1, minWidth: 0, paddingVertical: 9 }}>
        <Text style={[t.type.body, { color: t.color.text }]} numberOfLines={1}>
          {description}
        </Text>
        <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      {queued && !item.landing && (
        <View
          style={{
            flexShrink: 0,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 999,
            backgroundColor: t.color.warnSoft,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: '600',
              letterSpacing: 0.4,
              color: t.color.warnStrong,
            }}
          >
            {tr('draft.queued').toUpperCase()}
          </Text>
        </View>
      )}
      {!!pendingStatus && (
        <View
          style={{
            flexShrink: 0,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 999,
            backgroundColor: t.color.accentSoft,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: '600',
              letterSpacing: 0.4,
              color: t.color.accentStrong,
            }}
          >
            {tr(PENDING_LABEL_KEYS[pendingStatus]).toUpperCase()}
          </Text>
        </View>
      )}

      <Money amount={item.amount} currency={currency} type={item.type} />

      {!isLast && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 56,
            right: 0,
            height: 1,
            backgroundColor: t.color.border,
          }}
        />
      )}
    </Pressable>
  );
});

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
  return (
    <View style={{ paddingHorizontal: t.space.lg, paddingTop: 10, paddingBottom: t.space.xs }}>
      <Card flush style={{ overflow: 'hidden' }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
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
