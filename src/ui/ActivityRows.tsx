// Activity's rows (design §6.4): one transaction's row, the account filter pills above the list,
// and a day's header. All memoized — a filter tap or a sync used to redraw every one of them.
// The pills are names only: the balances they used to show made the header a third of the
// screen, and an account's own page (long-press a pill) has them.
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { appLocale } from '../i18n';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { usePopOnChange } from './feedback';
import { useTheme } from './theme';
import { Chip, Dot, Money, PRESSED_OPACITY, SectionHeader } from './components';
import { currencyOf, formatMoney } from './money';
import { categoryColor } from './categoryColor';
import { navigateOnce } from './navigateOnce';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';
import type { PendingEditStatus } from '../transactions/pendingEdits';
import {
  MAX_SPLIT_LINES,
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
}: {
  item: ActivityItem;
  selecting: boolean;
  selected: boolean;
  currencies: Currencies;
  onPress: (item: ActivityItem) => void;
  onLongPress: (item: ActivityItem) => void;
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
  const dotColor = item.categoryName
    ? categoryColor(item.categoryName, t.dark)
    : item.type === 'transfer'
      ? t.color.transfer
      : t.color.textFaint;
  const selectable = !queued && !remote;
  // The mark pops as it toggles, alongside the tick haptic (src/ui/feedback.ts).
  const markPop = usePopOnChange(selected, 1.4);
  const splitLines = queued ? item.splits : remote ? [] : cachedSplitLines(item);
  const currency = currencyOf(currencies, item.currencyCode);
  return (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={selectable ? () => onLongPress(item) : undefined}
      // 500ms by default, which felt like the long-press hadn't registered.
      delayLongPress={300}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.sm,
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.sm,
        opacity: pressed ? PRESSED_OPACITY : 1,
        backgroundColor: selected ? t.color.accentSoft : undefined,
      })}
    >
      <Animated.View style={markPop}>
        {selecting && selectable ? (
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={20}
            color={selected ? t.color.accent : t.color.textFaint}
          />
        ) : (
          <Dot color={dotColor} />
        )}
      </Animated.View>
      <View style={{ flex: 1 }}>
        <Text style={[t.type.body, { color: t.color.text }]} numberOfLines={1}>
          {description}
        </Text>
        <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
          {[
            splitLines.length
              ? tr('splits.count', { count: splitLines.length })
              : item.categoryName,
            accountLeg,
          ]
            .filter(Boolean)
            .join(' · ') || (queued ? tr('draft.queued') : '—')}
        </Text>
        {splitLines.slice(0, MAX_SPLIT_LINES).map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: s.categoryName
                  ? categoryColor(s.categoryName, t.dark)
                  : t.color.textFaint,
              }}
            />
            <Text style={[t.type.label, { color: t.color.textMuted, flex: 1 }]} numberOfLines={1}>
              {s.label || '—'}
            </Text>
            <Text style={[t.type.label, t.type.money, { color: t.color.textMuted }]}>
              {formatMoney(s.amount, currency)}
            </Text>
          </View>
        ))}
        {splitLines.length > MAX_SPLIT_LINES && (
          <Text style={[t.type.label, { color: t.color.textFaint }]}>
            {tr('splits.more', { count: splitLines.length - MAX_SPLIT_LINES })}
          </Text>
        )}
      </View>
      {queued && !item.landing && <Chip label={tr('draft.queued')} tone="warn" />}
      {!!pendingStatus && <Chip label={tr(PENDING_LABEL_KEYS[pendingStatus])} tone="warn" />}
      <Money amount={item.amount} currency={currency} type={item.type} />
    </Pressable>
  );
});

/**
 * The balance cards above the list. Memoized, as is each card: a filter tap used to redraw every
 * card (and restart none of their rolls, but format all their dates), when only two change.
 */
export const BalanceStrip = memo(function BalanceStrip({
  accounts,
  selectedId,
  onToggle,
  pendingAccounts,
}: {
  accounts: ReferenceAccountRow[];
  selectedId: string | null;
  onToggle: (id: string) => void;
  pendingAccounts: Set<string>;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    // A ScrollView defaults to flexGrow/flexShrink 1, so this row competed with the SectionList
    // for height and had its pills clipped along the bottom edge.
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{
        paddingHorizontal: t.space.lg,
        gap: t.space.sm,
        paddingBottom: t.space.sm,
      }}
    >
      {accounts.map((a) => (
        <Chip
          key={a.id}
          label={a.name}
          selected={selectedId === a.id}
          // The same warning dot the account's own card carries while its changes are queued.
          dotColor={pendingAccounts.has(a.id) ? t.color.warn : undefined}
          onPress={() => onToggle(a.id)}
          onLongPress={() => navigateOnce(`/accounts/${a.id}`)}
          accessibilityHint={tr('account.openHint')}
        />
      ))}
    </ScrollView>
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
          <Text style={[t.type.label, { color: t.color.textMuted }]}>
            {totals
              .map((tot) => formatMoney(tot.amount, currencyOf(currencies, tot.currencyCode ?? '')))
              .join(' · ')}
          </Text>
        ) : undefined
      }
    />
  );
});
