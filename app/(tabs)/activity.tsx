// Activity (design §6.4) — balances, grouped-by-day history with totals, paging, search.
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, SectionList, Text, TextInput, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, SectionHeader, Card, Chip, Money, EmptyState, Sheet, Row } from '../../src/ui/components';
import { CaptureDock } from '../../src/ui/CaptureDock';
import { currencyOf, formatMoney } from '../../src/ui/money';
import { categoryColor } from '../../src/ui/categoryColor';
import { relativeTime } from '../../src/ui/relativeTime';
import { useTransactionPage, type ActivityTypeFilter, type CachedTransactionRow } from '../../src/transactions/useTransactionPage';
import { useSync } from '../../src/sync/useSync';
import { referenceAccounts, referenceCurrencies, outboxOperations, cachedTransactions } from '../../src/db/schema';
import type { CreateTransactionPayload } from '../../src/sync/outbox';

const FILTERS: { label: string; type: ActivityTypeFilter }[] = [
  { label: 'All', type: 'all' },
  { label: 'Spending', type: 'withdrawal' },
  { label: 'Income', type: 'deposit' },
  { label: 'Moves', type: 'transfer' },
];

const STALE_MS = 24 * 60 * 60 * 1000;

interface QueuedRow {
  queued: true;
  groupId: string;
  description: string;
  amount: string;
  currencyCode: string;
  type: 'withdrawal' | 'deposit' | 'transfer';
  sourceName: string | null;
  destinationName: string | null;
  categoryName: string | null;
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayTitle(key: string): string {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === localDayKey(now)) return 'TODAY';
  if (key === localDayKey(yesterday)) return 'YESTERDAY';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toUpperCase();
}

export default function ActivityScreen() {
  const db = useDb();
  const t = useTheme();
  const navigation = useNavigation();
  const listRef = useRef<SectionList<CachedTransactionRow | QueuedRow, DisplaySection>>(null);

  const [type, setType] = useState<ActivityTypeFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<string | null>(null);

  const { data: accountRows } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const { data: outbox } = useLiveQuery(db.select().from(outboxOperations));
  const { data: cachedTxRows } = useLiveQuery(db.select().from(cachedTransactions));
  const { status, syncNow } = useSync();
  const assetAccounts = (accountRows ?? []).filter((a) => a.type === 'asset');

  const { sections, loadMore, loadingMore, atEnd } = useTransactionPage({ search, type, accountName: accountFilter });

  const queuedRows: QueuedRow[] = (outbox ?? [])
    .filter((op) => op.kind === 'create_transaction' && op.status === 'pending')
    .map((op): QueuedRow | null => {
      const payload = JSON.parse(op.payloadJson) as CreateTransactionPayload;
      const split = payload.splits[0];
      if (!split) return null;
      return {
        queued: true, groupId: op.id, description: split.description, amount: split.amount,
        currencyCode: split.currency_code ?? '', type: split.type,
        sourceName: split.source_name ?? null, destinationName: split.destination_name ?? null,
        categoryName: split.category_name ?? null,
      };
    })
    .filter((r): r is QueuedRow => !!r);

  interface DisplaySection { key: string; totals: { currencyCode: string; amount: string }[]; data: (CachedTransactionRow | QueuedRow)[] }
  const todayKey = localDayKey(new Date());
  const displaySections: DisplaySection[] = sections.map((s): DisplaySection => ({ key: s.key, totals: s.totals, data: s.data }));
  if (queuedRows.length > 0) {
    const idx = displaySections.findIndex((s) => s.key === todayKey);
    if (idx >= 0) displaySections[idx] = { ...displaySections[idx]!, data: [...queuedRows, ...displaySections[idx]!.data] };
    else displaySections.unshift({ key: todayKey, totals: [], data: queuedRows });
  }

  function scrollToTop() {
    if (displaySections.length > 0) listRef.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, animated: true, viewOffset: 0 });
  }
  useEffect(() => {
    const unsubscribe = (navigation as unknown as { addListener: (event: string, cb: () => void) => () => void })
      .addListener('tabPress', () => { if (navigation.isFocused()) scrollToTop(); });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  const hasSyncedBefore = (cachedTxRows ?? []).length > 0;
  const hasResults = displaySections.length > 0;

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <AppBar
          title="Activity"
          right={(
            <View style={{ flexDirection: 'row', gap: t.space.md }}>
              <Pressable onPress={() => setSearchOpen((v) => !v)} accessibilityRole="button" accessibilityLabel="Search">
                <Ionicons name="search" size={20} color={t.color.text} />
              </Pressable>
              <Pressable onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="More">
                <Text style={[t.type.heading, { color: t.color.text }]}>⋯</Text>
              </Pressable>
            </View>
          )}
        />
        {searchOpen && (
          <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.sm }}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search description or payee"
              placeholderTextColor={t.color.textFaint}
              autoFocus
              style={{
                borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm,
                paddingHorizontal: t.space.md, paddingVertical: t.space.sm, color: t.color.text,
              }}
            />
          </View>
        )}

        {assetAccounts.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: t.space.lg, gap: t.space.sm, paddingBottom: t.space.sm }}>
            {assetAccounts.map((a) => {
              const stale = a.currentBalanceDate ? new Date().getTime() - new Date(a.currentBalanceDate).getTime() > STALE_MS : true;
              const selected = accountFilter === a.name;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setAccountFilter((cur) => (cur === a.name ? null : a.name))}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : stale ? 0.5 : 1 })}
                >
                  <Card style={{ borderColor: selected ? t.color.accent : t.color.border, minWidth: 120 }}>
                    <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>{a.name}</Text>
                    <Money amount={a.currentBalance ?? '0'} currency={currencyOf(currencies ?? [], a.currencyCode)} size="heading" />
                    <Text style={[t.type.label, { color: t.color.textFaint }]}>as of {relativeTime(a.currentBalanceDate)}</Text>
                  </Card>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <View style={{ flexDirection: 'row', paddingHorizontal: t.space.lg, gap: t.space.sm, paddingBottom: t.space.sm }}>
          {FILTERS.map((f) => (
            <Chip key={f.type} label={f.label} selected={type === f.type} onPress={() => setType(f.type)} />
          ))}
        </View>

        {!hasSyncedBefore && !hasResults && (
          <EmptyState glyph="↻" title="Nothing cached yet" hint="Pull to sync." />
        )}
        {hasSyncedBefore && !hasResults && (
          <EmptyState glyph="🔍" title="No results" hint="Try a different search or filter." />
        )}

        {hasResults && (
          <SectionList<CachedTransactionRow | QueuedRow, DisplaySection>
            ref={listRef}
            sections={displaySections}
            keyExtractor={(row) => row.groupId}
            refreshing={status === 'syncing'}
            onRefresh={syncNow}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            contentContainerStyle={{ paddingBottom: 140 }}
            renderSectionHeader={({ section }) => (
              <SectionHeader
                title={dayTitle(section.key)}
                action={section.totals.length > 0 ? (
                  <Text style={[t.type.label, { color: t.color.textMuted }]}>
                    {section.totals.map((tot) => formatMoney(tot.amount, currencyOf(currencies ?? [], tot.currencyCode ?? ''))).join(' · ')}
                  </Text>
                ) : undefined}
              />
            )}
            renderItem={({ item }) => {
              const queued = 'queued' in item;
              const description = item.description || (item.type === 'withdrawal' ? item.destinationName : item.sourceName) || '—';
              const accountLeg = item.type === 'deposit' ? item.sourceName : item.destinationName;
              const dotColor = item.categoryName ? categoryColor(item.categoryName, t.dark) : (item.type === 'transfer' ? t.color.transfer : t.color.textFaint);
              return (
                <Pressable
                  onPress={() => !queued && router.push(`/transactions/${item.groupId}`)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: t.space.sm,
                    paddingHorizontal: t.space.lg, paddingVertical: t.space.sm, opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[t.type.body, { color: t.color.text }]} numberOfLines={1}>{description}</Text>
                    <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
                      {[item.categoryName, accountLeg].filter(Boolean).join(' · ') || (queued ? 'Queued' : '—')}
                    </Text>
                  </View>
                  {queued && <Chip label="Queued" tone="warn" />}
                  <Money amount={item.amount} currency={currencyOf(currencies ?? [], item.currencyCode)} type={item.type} />
                </Pressable>
              );
            }}
            ListFooterComponent={!atEnd ? (
              <Text style={[t.type.label, { color: t.color.textFaint, textAlign: 'center', paddingVertical: t.space.lg }]}>
                {loadingMore ? 'Loading more…' : ' '}
              </Text>
            ) : null}
          />
        )}

        <CaptureDock />
      </View>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Activity">
        <Row first label="Count cash" chevron onPress={() => { setMenuOpen(false); router.push('/count'); }} />
      </Sheet>
    </Screen>
  );
}
