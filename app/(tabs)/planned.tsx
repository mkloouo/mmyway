// Planned. "Coming up" lists the next occurrences of every planned transaction, by date; "All plans"
// lists the planned transactions themselves (app/planned/[key].tsx). Firefly III's objects as it
// holds them are in Settings → Planned in Firefly III (app/settings/planned-raw.tsx).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQueries } from '@tanstack/react-query';
import { useDb } from '../../src/providers/DbProvider';
import { getClient } from '../../src/api/ff3/session';
import { compareDecimal } from '../../src/api/ff3/decimal';
import { useCaptureDefaults } from '../../src/capture/useCaptureDefaults';
import { useCurrencies } from '../../src/db/useReferenceData';
import { useTheme } from '../../src/ui/theme';
import {
  TabHeader,
  IconButton,
  Card,
  DateTile,
  EmptyState,
  ListRow,
  Money,
  Pill,
  SCREEN_TOP_PADDING,
  Screen,
  SectionHeader,
  Segmented,
} from '../../src/ui/kit';
import { PendingDot } from '../../src/ui/PendingDot';
import { currencyOf, formatMoney } from '../../src/money/format';
import { primaryCurrencyCode } from '../../src/money/currencies';
import { OccurrenceSheet, type Occurrence } from '../../src/ui/OccurrenceSheet';
import { usePlanned } from '../../src/planned/usePlanned';
import { dayLabel, scheduleLabel } from '../../src/planned/labels';
import { upcomingOccurrences } from '../../src/planned/occurrences';
import { fetchRecurrenceTransactions } from '../../src/planned/objects';
import { upcomingTotals } from '../../src/planned/upcomingTotals';
import type { PlannedItem } from '../../src/planned/items';
import { usePullToRefresh } from '../../src/sync/useSync';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { appLocale } from '../../src/i18n';
import { dayDate, localDay } from '../../src/utils/day';

// ponytail: two months of dates in one list; paging further out when someone asks for it.
const HORIZON_DAYS = 62;

const shiftDays = (day: string, days: number): string => {
  const d = dayDate(day);
  d.setDate(d.getDate() + days);
  return localDay(d);
};

/** The occurrences of one planned transaction from `today` up to `until`, skipped ones included. */
function occurrencesOf(item: PlannedItem, today: string, until: string): Occurrence[] {
  const f = item.fields;
  const from = f.date > today ? f.date : today;
  const days = f.repeats
    ? upcomingOccurrences(f.repetitions, from, { count: HORIZON_DAYS + 1, until })
    : [f.date].filter((d) => d >= today && d <= until);
  return days.map((day) => ({ item, day, skipped: f.skipDays.includes(day) }));
}

export default function PlannedScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  // Spins only for a pull the user made: tied to the sync status, it spun for every sync (launch,
  // a push after a write, reconnecting) as if the list had been pulled.
  const pull = usePullToRefresh();
  const { items, loaded } = usePlanned();
  const currencies = useCurrencies();
  const db = useDb();
  const { defaultCurrencyCode } = useCaptureDefaults();
  const [view, setView] = useState<'coming' | 'all'>('coming');
  const [picked, setPicked] = useState<Occurrence | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const today = localDay();
  const thisWeekEnd = shiftDays(today, 7 - (((dayDate(today).getDay() + 6) % 7) + 1));
  const until = shiftDays(today, HORIZON_DAYS);
  const occurrences = items
    .flatMap((item) => occurrencesOf(item, today, until))
    .sort(
      (a, b) => a.day.localeCompare(b.day) || a.item.fields.name.localeCompare(b.item.fields.name),
    );

  // What FF3 already booked from each recurrence: the same query and cache as the planned
  // transaction's "Already booked" list (src/ui/OccurrenceRows.tsx), read only while Coming up shows.
  const recurrenceIds = [
    ...new Set(
      occurrences.map((o) => o.item.group?.recurrence?.id).filter((id): id is string => !!id),
    ),
  ];
  const bookedQueries = useQueries({
    queries: recurrenceIds.map((recurrenceId) => ({
      queryKey: ['recurrence-transactions', recurrenceId],
      enabled: view === 'coming',
      queryFn: async () => {
        const client = await getClient(db);
        return client ? fetchRecurrenceTransactions(client, recurrenceId) : [];
      },
      retry: false,
    })),
  });
  // Matched on the booking's date, as the planned transaction's own list does. A "Book it now" is
  // dated today whatever occurrence fired it, so only an occurrence booked on its own day shows.
  const bookedKeys = new Set<string>();
  recurrenceIds.forEach((recurrenceId, i) => {
    for (const booking of bookedQueries[i]?.data ?? []) {
      const date = String(booking.attributes.transactions[0]?.date ?? '').slice(0, 10);
      if (date) bookedKeys.add(`${recurrenceId}:${date}`);
    }
  });
  const isBooked = (o: Occurrence): boolean => {
    const recurrenceId = o.item.group?.recurrence?.id;
    return !!recurrenceId && bookedKeys.has(`${recurrenceId}:${o.day}`);
  };

  // "Out, next 30 days" and "In", per currency. The default currency is the big figures; any other
  // currency is one line under them.
  const totals = upcomingTotals(
    occurrences.map((o) => ({
      day: o.day,
      skipped: o.skipped,
      type: o.item.fields.type,
      amount: o.item.fields.amount,
      currencyCode: o.item.fields.currencyCode,
    })),
    { from: today, until: shiftDays(today, 29) },
  );
  const mainCode =
    defaultCurrencyCode ?? primaryCurrencyCode(currencies) ?? Object.keys(totals)[0] ?? null;
  const main = mainCode ? (totals[mainCode] ?? { out: '0', in: '0' }) : null;
  const otherLine = Object.entries(totals)
    .filter(([code]) => code !== mainCode)
    .flatMap(([code, row]) => {
      const cur = currencyOf(currencies, code);
      return [
        compareDecimal(row.out, '0') !== 0
          ? tr('planned.summary.otherOut', { amount: formatMoney(row.out, cur) })
          : null,
        compareDecimal(row.in, '0') !== 0
          ? tr('planned.summary.otherIn', { amount: formatMoney(row.in, cur) })
          : null,
      ];
    })
    .filter((line): line is string => line !== null)
    .join(' · ');

  // Sections: "Today", "This week", "Later in <this month>", then one per later month.
  const titleOf = (day: string): string => {
    if (day === today) return tr('planned.coming.today');
    if (day <= thisWeekEnd) return tr('planned.coming.thisWeek');
    const sameYear = day.slice(0, 4) === today.slice(0, 4);
    const month = dayDate(day).toLocaleDateString(appLocale(), {
      month: 'long',
      year: sameYear ? undefined : 'numeric',
    });
    return day.slice(0, 7) === today.slice(0, 7) ? tr('planned.coming.laterIn', { month }) : month;
  };
  const sections: { title: string; rows: Occurrence[] }[] = [];
  for (const o of occurrences) {
    const title = titleOf(o.day);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.rows.push(o);
    else sections.push({ title, rows: [o] });
  }

  const pick = (o: Occurrence) => {
    setPicked(o);
    setSheetOpen(true);
  };
  const empty = (
    <EmptyState glyph="◷" title={tr('planned.emptyTitle')} hint={tr('planned.emptyHint')} />
  );

  return (
    <Screen>
      <TabHeader
        title={tr('planned.title')}
        right={
          <IconButton
            icon="add"
            label={tr('planned.add')}
            onPress={() => navigateOnce('/planned/new')}
          />
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: SCREEN_TOP_PADDING, paddingBottom: t.space.xxl }}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <View style={{ paddingHorizontal: t.space.lg }}>
          <Segmented
            options={[
              { key: 'coming', label: tr('planned.comingUp') },
              { key: 'all', label: tr('planned.allPlans', { count: items.length }) },
            ]}
            value={view}
            onChange={setView}
            accessibilityLabel={tr('planned.title')}
          />
        </View>

        {view === 'coming' ? (
          <>
            {main && mainCode && (
              <View
                testID="planned-summary"
                style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.sm }}
              >
                <Card>
                  <View style={{ flexDirection: 'row' }}>
                    <View style={{ flex: 1, gap: t.space.xs }}>
                      <Text style={[t.type.label, { color: t.color.textMuted }]}>
                        {tr('planned.summary.out')}
                      </Text>
                      <Text style={[t.type.amount, { color: t.color.text }]}>
                        {formatMoney(main.out, currencyOf(currencies, mainCode))}
                      </Text>
                    </View>
                    <View
                      style={{
                        flex: 1,
                        gap: t.space.xs,
                        borderLeftWidth: StyleSheet.hairlineWidth,
                        borderLeftColor: t.color.border,
                        paddingLeft: t.space.lg,
                      }}
                    >
                      <Text style={[t.type.label, { color: t.color.textMuted }]}>
                        {tr('planned.summary.in')}
                      </Text>
                      <Text style={[t.type.amount, { color: t.color.income }]}>
                        {`+${formatMoney(main.in, currencyOf(currencies, mainCode))}`}
                      </Text>
                    </View>
                  </View>
                  {otherLine !== '' && (
                    <Text
                      style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.sm }]}
                    >
                      {otherLine}
                    </Text>
                  )}
                </Card>
              </View>
            )}
            {sections.map((section, i) => (
              <View key={section.title}>
                <SectionHeader title={section.title} first={i === 0 && !mainCode} />
                <View style={{ paddingHorizontal: t.space.lg }}>
                  <Card flush>
                    {section.rows.map((o, j) => {
                      const f = o.item.fields;
                      const route = [f.sourceName, f.destinationName].filter(Boolean).join(' → ');
                      return (
                        <ListRow
                          key={`${o.item.key}:${o.day}`}
                          first={j === 0}
                          leading={<DateTile date={o.day} />}
                          label={f.name}
                          struck={o.skipped}
                          sub={[route, f.categoryName].filter(Boolean).join(' · ') || undefined}
                          trailing={
                            isBooked(o) ? (
                              <View style={{ alignItems: 'flex-end', gap: t.space.xs }}>
                                <Money
                                  amount={f.amount}
                                  currency={currencyOf(currencies, f.currencyCode)}
                                  type={f.type}
                                  struck={o.skipped}
                                />
                                <Pill tone="income" size="sm" label={tr('planned.coming.booked')} />
                              </View>
                            ) : (
                              <Money
                                amount={f.amount}
                                currency={currencyOf(currencies, f.currencyCode)}
                                type={f.type}
                                struck={o.skipped}
                              />
                            )
                          }
                          onPress={() => pick(o)}
                        />
                      );
                    })}
                  </Card>
                </View>
              </View>
            ))}
          </>
        ) : (
          <View style={{ paddingHorizontal: t.space.lg }}>
            <Card flush>
              {items.map((item, i) => {
                const f = item.fields;
                const route = [f.sourceName, f.destinationName].filter(Boolean).join(' → ');
                return (
                  <ListRow
                    key={item.key}
                    first={i === 0}
                    leading={item.queued ? <PendingDot visible /> : undefined}
                    label={f.name}
                    sub={[
                      route,
                      f.categoryName,
                      scheduleLabel(f, item.group),
                      tr('planned.next', { date: dayLabel(f.date) }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    trailing={
                      <Money
                        amount={f.amount}
                        currency={currencyOf(currencies, f.currencyCode)}
                        type={f.type}
                      />
                    }
                    chevron
                    onPress={() => navigateOnce(`/planned/${encodeURIComponent(item.key)}`)}
                  />
                );
              })}
            </Card>
          </View>
        )}

        {loaded && (view === 'coming' ? sections.length === 0 : items.length === 0) && empty}
      </ScrollView>

      <OccurrenceSheet
        visible={sheetOpen}
        occurrence={picked}
        booked={picked ? isBooked(picked) : false}
        onClose={() => setSheetOpen(false)}
      />
    </Screen>
  );
}
