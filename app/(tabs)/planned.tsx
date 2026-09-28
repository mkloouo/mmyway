// Planned (subscriptions, rules and recurring transactions). The simple view lists one planned
// transaction per name — the three FF3 objects edited together (app/planned/[key].tsx); the
// detailed view lists each kind as FF3 has it, read-only (app/planned/object/[key].tsx).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { eq } from 'drizzle-orm';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useDb } from '../../src/providers/DbProvider';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  AppBar,
  BarIconButton,
  Card,
  Chip,
  EmptyState,
  Money,
} from '../../src/ui/components';
import { PendingDot } from '../../src/ui/PendingDot';
import { currencyOf } from '../../src/ui/money';
import { categoryColor } from '../../src/ui/categoryColor';
import { appSettings, referenceCurrencies } from '../../src/db/schema';
import {
  PLANNED_MODE_KEY,
  parsePlannedMode,
  setPlannedMode,
  type PlannedMode,
} from '../../src/settings/appSettings';
import { usePlanned } from '../../src/planned/usePlanned';
import { dayLabel, objectSummary, scheduleLabel } from '../../src/planned/labels';
import type { PlannedKind } from '../../src/planned/objects';
import { usePullToRefresh } from '../../src/sync/useSync';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { useAction } from '../../src/ui/useAction';

const KIND_TABS: { kind: PlannedKind; labelKey: string }[] = [
  { kind: 'bill', labelKey: 'planned.subscriptions' },
  { kind: 'rule', labelKey: 'planned.rules' },
  { kind: 'recurrence', labelKey: 'planned.recurring' },
];

export default function PlannedScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  // Spins only for a pull the user made: tied to the sync status, it spun for every sync (launch,
  // a push after a write, reconnecting) as if the list had been pulled.
  const pull = usePullToRefresh();
  const { objects, items, loaded } = usePlanned();
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const { data: modeRows } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.key, PLANNED_MODE_KEY)),
  );
  const mode = parsePlannedMode(modeRows?.[0]?.value);
  const [kind, setKind] = useState<PlannedKind>('bill');

  const chooseMode = act(tr('planned.title'), (next: PlannedMode) => setPlannedMode(db, next));
  const refresh = <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />;
  const objectsOfKind = objects
    .filter((o) => o.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Screen>
      <AppBar
        title={tr('planned.title')}
        right={
          mode === 'simple' ? (
            <BarIconButton
              icon="add"
              label={tr('planned.add')}
              onPress={() => navigateOnce('/planned/new')}
            />
          ) : undefined
        }
      />
      <View
        style={{
          flexDirection: 'row',
          gap: t.space.sm,
          paddingHorizontal: t.space.lg,
          paddingBottom: t.space.sm,
        }}
      >
        <Chip
          label={tr('planned.simple')}
          selected={mode === 'simple'}
          onPress={() => chooseMode('simple')}
        />
        <Chip
          label={tr('planned.detailed')}
          selected={mode === 'detailed'}
          onPress={() => chooseMode('detailed')}
        />
      </View>
      {mode === 'detailed' && (
        <View
          style={{
            flexDirection: 'row',
            gap: t.space.sm,
            paddingHorizontal: t.space.lg,
            paddingBottom: t.space.sm,
          }}
        >
          {KIND_TABS.map((k) => (
            <Chip
              key={k.kind}
              label={tr(k.labelKey)}
              selected={kind === k.kind}
              onPress={() => setKind(k.kind)}
            />
          ))}
        </View>
      )}

      {mode === 'simple' ? (
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          refreshControl={refresh}
          contentContainerStyle={{ paddingBottom: t.space.xxl, gap: t.space.sm }}
          ListEmptyComponent={
            loaded ? (
              <EmptyState
                glyph="◷"
                title={tr('planned.emptyTitle')}
                hint={tr('planned.emptyHint')}
              />
            ) : null
          }
          renderItem={({ item }) => {
            const f = item.fields;
            const counterparty = f.type === 'deposit' ? f.sourceName : f.destinationName;
            return (
              <Card
                style={{ marginHorizontal: t.space.lg }}
                onPress={() => navigateOnce(`/planned/${encodeURIComponent(item.key)}`)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                  <PendingDot visible={item.queued} />
                  <Text
                    style={[t.type.heading, { color: t.color.text, flex: 1 }]}
                    numberOfLines={1}
                  >
                    {f.name}
                  </Text>
                  <Money
                    amount={f.amount}
                    currency={currencyOf(currencies ?? [], f.currencyCode)}
                    type={f.type}
                    size="heading"
                  />
                </View>
                <Text
                  style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}
                  numberOfLines={1}
                >
                  {[scheduleLabel(f), tr('planned.next', { date: dayLabel(f.date) }), counterparty]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {!!f.categoryName && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: t.space.xs,
                      marginTop: t.space.xs,
                    }}
                  >
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: categoryColor(f.categoryName, t.dark),
                      }}
                    />
                    <Text
                      style={[t.type.label, { color: t.color.textMuted, flex: 1 }]}
                      numberOfLines={1}
                    >
                      {f.categoryName}
                    </Text>
                  </View>
                )}
              </Card>
            );
          }}
        />
      ) : (
        <FlatList
          data={objectsOfKind}
          keyExtractor={(o) => o.key}
          refreshControl={refresh}
          contentContainerStyle={{ paddingBottom: t.space.xxl, gap: t.space.sm }}
          ListEmptyComponent={
            loaded ? (
              <EmptyState
                glyph="◷"
                title={tr('planned.noneOfKind')}
                hint={tr('planned.emptyHint')}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <Card
              style={{ marginHorizontal: t.space.lg }}
              onPress={() =>
                router.push({ pathname: '/planned/object/[key]', params: { key: item.key } })
              }
            >
              <Text style={[t.type.heading, { color: t.color.text }]} numberOfLines={1}>
                {item.name || '—'}
              </Text>
              <Text
                style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}
                numberOfLines={2}
              >
                {objectSummary(item)}
              </Text>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
