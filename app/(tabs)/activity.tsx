// Activity (design §6.4) — balances, grouped-by-day history with totals, paging, search.
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, SectionList, Text, TextInput, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, SectionHeader, Card, Chip, Money, EmptyState, Sheet, Row } from '../../src/ui/components';
import { CaptureDock } from '../../src/ui/CaptureDock';
import { currencyOf, formatMoney } from '../../src/ui/money';
import { categoryColor } from '../../src/ui/categoryColor';
import { relativeTime } from '../../src/ui/relativeTime';
import { useTransactionPage, type ActivityTypeFilter, type CachedTransactionRow } from '../../src/transactions/useTransactionPage';
import { useLoadOlderHistory, usePullToRefresh } from '../../src/sync/useSync';
import { getClient } from '../../src/api/ff3/session';
import { referenceCurrencies, outboxOperations, cachedTransactions } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import type { CreateTransactionPayload } from '../../src/sync/outbox';
import type { TransactionRead } from '../../src/api/ff3/types';
import { navigateOnce } from '../../src/ui/navigateOnce';

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
  inboxItemId: string | null;
  description: string;
  amount: string;
  currencyCode: string;
  type: 'withdrawal' | 'deposit' | 'transfer';
  sourceName: string | null;
  destinationName: string | null;
  categoryName: string | null;
}

interface RemoteResultRow {
  remote: true;
  groupId: string;
  description: string;
  amount: string;
  currencyCode: string;
  type: 'withdrawal' | 'deposit' | 'transfer';
  sourceName: string | null;
  destinationName: string | null;
  categoryName: string | null;
}

function mapRemoteResult(group: TransactionRead): RemoteResultRow | null {
  const journal = group.attributes.transactions[0];
  if (!journal) return null;
  return {
    remote: true,
    groupId: group.id,
    description: journal.description,
    amount: journal.amount,
    currencyCode: journal.currency_code ?? '',
    type: journal.type as 'withdrawal' | 'deposit' | 'transfer',
    sourceName: journal.source_name ?? null,
    destinationName: journal.destination_name ?? null,
    categoryName: journal.category_name ?? null,
  };
}

type RemoteSearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; rows: RemoteResultRow[] }
  | { status: 'error'; query: string }
  | { status: 'offline'; query: string };

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
  const listRef = useRef<SectionList<CachedTransactionRow | QueuedRow | RemoteResultRow, DisplaySection>>(null);

  const [type, setType] = useState<ActivityTypeFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<string | null>(null);

  const assetAccounts = useAssetAccounts() ?? [];
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const { data: outbox } = useLiveQuery(db.select().from(outboxOperations));
  // Just "has anything ever synced" — .limit(1) instead of loading the whole cached table.
  const { data: cachedTxProbe } = useLiveQuery(db.select({ id: cachedTransactions.groupId }).from(cachedTransactions).limit(1));

  const { sections, loadMore, loadingMore, atEnd } = useTransactionPage({ search, type, accountName: accountFilter });
  const { loadOlder, loadingOlder, exhausted, reset: resetExhausted } = useLoadOlderHistory();
  // The local cache runs out before real history does — reaching the end of what's cached pulls
  // a further chunk from FF3 instead of just stopping (see useLoadOlderHistory).
  function handleEndReached() {
    if (!atEnd) { loadMore(); return; }
    if (!exhausted) void loadOlder();
  }
  const reachedRealEnd = atEnd && exhausted;
  // A pull-to-refresh is the user asking "check again" — `exhausted` otherwise only ever latches
  // forward for the lifetime of this screen.
  const pull = usePullToRefresh(resetExhausted);

  // Once local search runs out of cached rows to page through, FF3's own search covers what
  // hasn't been pulled into cachedTransactions yet — kept as a separate section rather than
  // written into the cache, so local search stays a predictable, offline-first read.
  const remoteQuery = reachedRealEnd ? search.trim() : '';
  // Only ever holds a *finished* fetch (never "loading") — "loading" is derived below from
  // whether this still matches remoteQuery, rather than set eagerly at the top of the effect.
  const [fetchedSearch, setFetchedSearch] = useState<
    { query: string; status: 'done'; rows: RemoteResultRow[] } | { query: string; status: 'error' | 'offline' } | null
  >(null);
  useEffect(() => {
    if (!remoteQuery) return;
    let cancelled = false;
    (async () => {
      const client = await getClient(db);
      if (!client) {
        if (!cancelled) setFetchedSearch({ status: 'offline', query: remoteQuery });
        return;
      }
      try {
        const response = await client.request<{ data: TransactionRead[] }>(
          `/v1/search/transactions?query=${encodeURIComponent(remoteQuery)}&limit=50&page=1`,
        );
        if (cancelled) return;
        const rows = response.data.map(mapRemoteResult).filter((r): r is RemoteResultRow => !!r);
        setFetchedSearch({ status: 'done', query: remoteQuery, rows });
      } catch {
        if (!cancelled) setFetchedSearch({ status: 'error', query: remoteQuery });
      }
    })();
    return () => { cancelled = true; };
  }, [db, remoteQuery]);
  // Once the query changes, the fetch above hasn't re-run yet — falling back to "loading" here
  // instead of resetting fetchedSearch avoids a stale result flashing under the new query.
  const remoteSearch: RemoteSearchState = !remoteQuery ? { status: 'idle' }
    : fetchedSearch?.query === remoteQuery ? fetchedSearch
    : { status: 'loading', query: remoteQuery };

  const queuedRows: QueuedRow[] = (outbox ?? [])
    .filter((op) => op.kind === 'create_transaction' && op.status === 'pending')
    .map((op): QueuedRow | null => {
      const payload = JSON.parse(op.payloadJson) as CreateTransactionPayload;
      const split = payload.splits[0];
      if (!split) return null;
      return {
        queued: true, groupId: op.id, inboxItemId: op.inboxItemId, description: split.description, amount: split.amount,
        currencyCode: split.currency_code ?? '', type: split.type,
        sourceName: split.source_name ?? null, destinationName: split.destination_name ?? null,
        categoryName: split.category_name ?? null,
      };
    })
    .filter((r): r is QueuedRow => !!r);

  const REMOTE_SECTION_KEY = 'ff3-search';
  interface DisplaySection { key: string; totals: { currencyCode: string; amount: string }[]; data: (CachedTransactionRow | QueuedRow | RemoteResultRow)[] }
  const todayKey = localDayKey(new Date());
  // A queued delete takes the row out right away — it used to sit there, unchanged, until a
  // pull-to-refresh after the delete had gone through.
  const pendingDeletes = new Set((outbox ?? [])
    .filter((op) => op.kind === 'delete_transaction' && op.status !== 'failed')
    .map((op) => { try { return (JSON.parse(op.payloadJson) as { groupId?: string }).groupId; } catch { return undefined; } })
    .filter((id): id is string => !!id));
  const displaySections: DisplaySection[] = sections
    .map((s): DisplaySection => ({ key: s.key, totals: s.totals, data: s.data.filter((row) => !pendingDeletes.has(row.groupId)) }))
    .filter((s) => s.data.length > 0);
  if (queuedRows.length > 0) {
    const idx = displaySections.findIndex((s) => s.key === todayKey);
    if (idx >= 0) displaySections[idx] = { ...displaySections[idx]!, data: [...queuedRows, ...displaySections[idx]!.data] };
    else displaySections.unshift({ key: todayKey, totals: [], data: queuedRows });
  }
  if (remoteSearch.status === 'done' && remoteSearch.rows.length > 0) {
    displaySections.push({ key: REMOTE_SECTION_KEY, totals: [], data: remoteSearch.rows });
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

  // undefined until the first read lands, so a synced-but-empty Activity doesn't flash "Nothing
  // cached yet" before flipping to "No results" once the probe resolves.
  const hasSyncedBefore = cachedTxProbe === undefined ? undefined : cachedTxProbe.length > 0;
  const hasResults = displaySections.length > 0;

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {/* Search takes the app bar's place rather than adding a row below it, so opening it
            does not shove the balances and the list down the screen. */}
        {searchOpen ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingHorizontal: t.space.lg, paddingVertical: t.space.md }}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search description or payee"
              placeholderTextColor={t.color.textFaint}
              autoFocus
              style={{
                flex: 1, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm,
                paddingHorizontal: t.space.md, paddingVertical: t.space.sm, color: t.color.text,
              }}
            />
            <Pressable
              onPress={() => { setSearch(''); setAccountFilter(null); setType('all'); setSearchOpen(false); }}
              accessibilityRole="button"
              accessibilityLabel="Clear search and filters"
              style={({ pressed }) => ({ padding: t.space.sm, opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons name="close" size={20} color={t.color.textMuted} />
            </Pressable>
          </View>
        ) : (
          <AppBar
            title="Activity"
            right={(
              <View style={{ flexDirection: 'row', gap: t.space.md }}>
                <Pressable onPress={() => setSearchOpen(true)} accessibilityRole="button" accessibilityLabel="Search">
                  <Ionicons name="search" size={20} color={t.color.text} />
                </Pressable>
                <Pressable onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="More">
                  <Text style={[t.type.heading, { color: t.color.text }]}>⋯</Text>
                </Pressable>
              </View>
            )}
          />
        )}

        {assetAccounts.length > 0 && (
          // A ScrollView defaults to flexGrow/flexShrink 1, so this row competed with the
          // SectionList for height and had its cards clipped along the bottom edge.
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, flexShrink: 0 }}
            contentContainerStyle={{ paddingHorizontal: t.space.lg, gap: t.space.sm, paddingBottom: t.space.sm }}
          >
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

        {hasSyncedBefore === false && !hasResults && (
          <EmptyState glyph="↻" title="Nothing cached yet" hint="Pull to sync." />
        )}
        {hasSyncedBefore === true && !hasResults && (
          <EmptyState glyph="🔍" title="No results" hint="Try a different search or filter." />
        )}

        {hasResults && (
          <SectionList<CachedTransactionRow | QueuedRow | RemoteResultRow, DisplaySection>
            // A new filter is a new list: without the remount a list scrolled deep into All kept
            // its offset over the much shorter Income list, so onEndReached fired over and over
            // and the list paged (and scrolled) by itself.
            key={`${type}:${accountFilter ?? ''}:${search.trim()}`}
            ref={listRef}
            style={{ flex: 1 }}
            sections={displaySections}
            keyExtractor={(row) => row.groupId}
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            contentContainerStyle={{ paddingBottom: 140 }}
            renderSectionHeader={({ section }) => (
              <SectionHeader
                title={section.key === REMOTE_SECTION_KEY ? 'FROM FIREFLY III' : dayTitle(section.key)}
                action={section.totals.length > 0 ? (
                  <Text style={[t.type.label, { color: t.color.textMuted }]}>
                    {section.totals.map((tot) => formatMoney(tot.amount, currencyOf(currencies ?? [], tot.currencyCode ?? ''))).join(' · ')}
                  </Text>
                ) : undefined}
              />
            )}
            renderItem={({ item }) => {
              const queued = 'queued' in item;
              // A remote-search row isn't cached locally yet, so there's nothing for the detail
              // screen (which only reads cachedTransactions) to open.
              const remote = 'remote' in item;
              const description = item.description || (item.type === 'withdrawal' ? item.destinationName : item.sourceName) || '—';
              const accountLeg = item.type === 'deposit' ? item.sourceName : item.destinationName;
              const dotColor = item.categoryName ? categoryColor(item.categoryName, t.dark) : (item.type === 'transfer' ? t.color.transfer : t.color.textFaint);
              return (
                <Pressable
                  onPress={() => {
                    // A queued entry isn't in FF3 yet: open it as its Inbox draft, where a
                    // still-waiting one can be cancelled.
                    if (queued) { if (item.inboxItemId) navigateOnce(`/draft/${item.inboxItemId}`); return; }
                    if (!remote) navigateOnce(`/transactions/${item.groupId}`);
                  }}
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
            ListFooterComponent={(
              <>
                {!reachedRealEnd && (
                  <Text style={[t.type.label, { color: t.color.textFaint, textAlign: 'center', paddingVertical: t.space.lg }]}>
                    {loadingMore || loadingOlder ? 'Loading more…' : ' '}
                  </Text>
                )}
                {remoteSearch.status === 'loading' && (
                  <Text style={[t.type.label, { color: t.color.textFaint, textAlign: 'center', paddingVertical: t.space.lg }]}>
                    Searching Firefly III…
                  </Text>
                )}
                {remoteSearch.status === 'offline' && (
                  <Text style={[t.type.label, { color: t.color.textFaint, textAlign: 'center', paddingVertical: t.space.lg }]}>
                    Can&apos;t search Firefly III while offline
                  </Text>
                )}
                {remoteSearch.status === 'error' && (
                  <Text style={[t.type.label, { color: t.color.warn, textAlign: 'center', paddingVertical: t.space.lg }]}>
                    Searching Firefly III failed
                  </Text>
                )}
                {remoteSearch.status === 'done' && remoteSearch.rows.length === 0 && (
                  <Text style={[t.type.label, { color: t.color.textFaint, textAlign: 'center', paddingVertical: t.space.lg }]}>
                    Nothing more in Firefly III
                  </Text>
                )}
              </>
            )}
          />
        )}

        <CaptureDock />
      </View>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Activity">
        <Row first label="Count cash" chevron onPress={() => { setMenuOpen(false); navigateOnce('/count'); }} />
      </Sheet>
    </Screen>
  );
}
