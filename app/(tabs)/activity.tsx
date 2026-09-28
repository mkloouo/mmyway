// Activity (design §6.4) — balances, grouped-by-day history with totals, paging, search.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { appLocale } from '../../src/i18n';
import { Pressable, ScrollView, SectionList, Text, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDb } from '../../src/providers/DbProvider';
import { SearchField } from '../../src/ui/SearchField';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, BarRow, BarIconButton, SectionHeader, Card, Chip, Money, EmptyState, Sheet, Row, Button } from '../../src/ui/components';
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
import { confirmDestructive } from '../../src/ui/confirm';
import { cachedRowFromGroup } from '../../src/sync/referenceData';
import { enqueueOperation } from '../../src/sync/outbox';
import { generateId } from '../../src/utils/id';
import { inArray } from 'drizzle-orm';
import { haptics } from '../../src/ui/haptics';
import { pendingEdits, applyPendingEdit, type PendingEditStatus } from '../../src/transactions/pendingEdits';

const FILTERS: { labelKey: string; type: ActivityTypeFilter }[] = [
  { labelKey: 'activity.filterAll', type: 'all' },
  { labelKey: 'activity.filterSpending', type: 'withdrawal' },
  { labelKey: 'activity.filterIncome', type: 'deposit' },
  { labelKey: 'activity.filterMoves', type: 'transfer' },
];

const STALE_MS = 24 * 60 * 60 * 1000;
const REMOTE_SECTION_KEY = 'ff3-search';
const PENDING_LABEL_KEYS: Record<PendingEditStatus, string> = { queued: 'draft.queued', failed: 'activity.notSent', conflict: 'inbox.conflict' };

/** A cached row, plus the state of any edit to it that is saved here but not yet in FF3. */
type ActivityCachedRow = CachedTransactionRow & { pendingStatus?: PendingEditStatus };
type ActivityItem = ActivityCachedRow | QueuedRow | RemoteResultRow;
interface DisplaySection { key: string; totals: { currencyCode: string; amount: string }[]; data: ActivityItem[] }
type Currencies = (typeof referenceCurrencies.$inferSelect)[];

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
  /** The full FF3 answer, cached on tap so the detail screen (which reads the cache) can open it. */
  group: TransactionRead;
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
    group,
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
  if (key === localDayKey(now)) return i18n.t('capture.today').toUpperCase();
  if (key === localDayKey(yesterday)) return i18n.t('capture.yesterday').toUpperCase();
  const [y, m, d] = key.split('-').map(Number);
  // Always with the year: scrolling back past January otherwise gave two identical "14 SEP"s.
  return new Date(y!, m! - 1, d!).toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
}

export default function ActivityScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation();
  const listRef = useRef<SectionList<ActivityItem, DisplaySection>>(null);

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

  const { sections, loadMore, loadingMore, atEnd } = useTransactionPage({ search, type, accountId: accountFilter });
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

  // Multi-select (long-press a row): bulk delete, each as its own conflict-checked outbox delete.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selecting = selectedIds.size > 0;
  const toggleSelected = useCallback((groupId: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }, []);
  async function deleteSelected() {
    const ids = [...selectedIds];
    if (!await confirmDestructive(tr('activity.deleteTitle', { count: ids.length }), tr('common.delete'), tr('activity.deleteBody'))) return;
    const rows = await db.select({ groupId: cachedTransactions.groupId, updatedAt: cachedTransactions.updatedAt })
      .from(cachedTransactions).where(inArray(cachedTransactions.groupId, ids));
    for (const row of rows) {
      await enqueueOperation(db, { id: generateId(), kind: 'delete_transaction', payload: { groupId: row.groupId, expectedUpdatedAt: row.updatedAt } });
    }
    setSelectedIds(new Set());
  }

  // A FF3 search result isn't in the local cache; store the copy we already have, then open it.
  const openRemote = useCallback(async (item: RemoteResultRow) => {
    const row = cachedRowFromGroup(item.group, new Date().toISOString());
    if (!row) return;
    await db.insert(cachedTransactions).values(row).onConflictDoUpdate({ target: cachedTransactions.groupId, set: row });
    navigateOnce(`/transactions/${item.groupId}`);
  }, [db]);

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

  // Everything read from the outbox, parsed once per outbox change rather than on every render —
  // a selection tap re-renders this screen, and re-parsing every queued payload each time was
  // part of why multi-select lagged.
  const { queuedRows, pendingDeletes, edits } = useMemo(() => {
    const ops = outbox ?? [];
    const queued: QueuedRow[] = ops
      .filter((op) => op.kind === 'create_transaction' && (op.status === 'pending' || op.status === 'in_flight'))
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
    // A queued delete takes the row out right away — it used to sit there, unchanged, until a
    // pull-to-refresh after the delete had gone through.
    const deletes = new Set(ops
      .filter((op) => op.kind === 'delete_transaction' && op.status !== 'failed')
      .map((op) => { try { return (JSON.parse(op.payloadJson) as { groupId?: string }).groupId; } catch { return undefined; } })
      .filter((id): id is string => !!id));
    return { queuedRows: queued, pendingDeletes: deletes, edits: pendingEdits(ops) };
  }, [outbox]);

  const remoteRows = remoteSearch.status === 'done' ? remoteSearch.rows : null;
  const displaySections = useMemo(() => {
    const todayKey = localDayKey(new Date());
    const result: DisplaySection[] = sections
      .map((s): DisplaySection => ({
        key: s.key,
        totals: s.totals,
        data: s.data
          .filter((row) => !pendingDeletes.has(row.groupId))
          // An edit saved here shows its new values, marked queued until FF3 has it.
          .map((row): ActivityCachedRow => {
            const pending = applyPendingEdit(row, edits);
            return pending ? { ...pending.row, pendingStatus: pending.status } : row;
          }),
      }))
      .filter((s) => s.data.length > 0);
    if (queuedRows.length > 0) {
      const idx = result.findIndex((s) => s.key === todayKey);
      if (idx >= 0) result[idx] = { ...result[idx]!, data: [...queuedRows, ...result[idx]!.data] };
      else result.unshift({ key: todayKey, totals: [], data: queuedRows });
    }
    if (remoteRows && remoteRows.length > 0) {
      result.push({ key: REMOTE_SECTION_KEY, totals: [], data: remoteRows });
    }
    return result;
  }, [sections, pendingDeletes, edits, queuedRows, remoteRows]);

  // Rows get callbacks that only change when selection mode starts or ends (when every row
  // re-renders anyway), so a memoized row re-renders only when its own selected state changes —
  // not every row on every tap.
  const onRowPress = useCallback((item: ActivityItem) => {
    // A queued entry isn't in FF3 yet: open it as its Inbox draft, where a still-waiting one can
    // be cancelled.
    if ('queued' in item) { if (item.inboxItemId) navigateOnce(`/draft/${item.inboxItemId}`); return; }
    if (selecting) { toggleSelected(item.groupId); return; }
    if ('remote' in item) { void openRemote(item); return; }
    navigateOnce(`/transactions/${item.groupId}`);
  }, [selecting, toggleSelected, openRemote]);
  const onRowLongPress = useCallback((item: ActivityItem) => {
    void haptics.tick();
    toggleSelected(item.groupId);
  }, [toggleSelected]);
  const renderItem = useCallback(({ item }: { item: ActivityItem }) => (
    <ActivityRow
      item={item}
      selecting={selecting}
      selected={selectedIds.has(item.groupId)}
      currencies={currencies}
      onPress={onRowPress}
      onLongPress={onRowLongPress}
    />
  ), [selecting, selectedIds, currencies, onRowPress, onRowLongPress]);

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
        {selecting ? (
          <AppBar
            title={tr('inbox.selected', { count: selectedIds.size })}
            left={<BarIconButton icon="close" label={tr('inbox.cancelSelection')} onPress={() => setSelectedIds(new Set())} />}
            right={<Button title={tr('common.delete')} variant="danger" size="bar" onPress={deleteSelected} />}
          />
        ) : searchOpen ? (
          <BarRow>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder={tr('activity.searchPlaceholder')}
              autoFocus
              onClear={() => { setSearch(''); setAccountFilter(null); setType('all'); setSearchOpen(false); }}
              style={{ flex: 1 }}
            />
          </BarRow>
        ) : (
          <AppBar
            title={tr('activity.title')}
            right={(
              <>
                <BarIconButton icon="search" label={tr('activity.search')} onPress={() => setSearchOpen(true)} />
                <BarIconButton icon="ellipsis-horizontal" label={tr('capture.more')} onPress={() => setMenuOpen(true)} />
              </>
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
              const selected = accountFilter === a.id;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setAccountFilter((cur) => (cur === a.id ? null : a.id))}
                  onLongPress={() => navigateOnce(`/accounts/${a.id}`)}
                  delayLongPress={300}
                  accessibilityHint={tr('account.openHint')}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : stale ? 0.5 : 1 })}
                >
                  <Card style={{ borderColor: selected ? t.color.accent : t.color.border, minWidth: 120 }}>
                    <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>{a.name}</Text>
                    <Money amount={a.currentBalance ?? '0'} currency={currencyOf(currencies ?? [], a.currencyCode)} size="heading" />
                    <Text style={[t.type.label, { color: t.color.textFaint }]}>{tr('count.asOf', { time: relativeTime(a.currentBalanceDate) })}</Text>
                  </Card>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <View style={{ flexDirection: 'row', paddingHorizontal: t.space.lg, gap: t.space.sm, paddingBottom: t.space.sm }}>
          {FILTERS.map((f) => (
            <Chip key={f.type} label={tr(f.labelKey)} selected={type === f.type} onPress={() => setType(f.type)} />
          ))}
        </View>

        {hasSyncedBefore === false && !hasResults && (
          <EmptyState glyph="↻" title={tr('activity.nothingCachedTitle')} hint={tr('activity.nothingCachedHint')} />
        )}
        {hasSyncedBefore === true && !hasResults && (
          <EmptyState glyph="🔍" title={tr('activity.noResultsTitle')} hint={tr('activity.noResultsHint')} />
        )}

        {hasResults && (
          <SectionList<ActivityItem, DisplaySection>
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
                title={section.key === REMOTE_SECTION_KEY ? tr('activity.fromFf3') : dayTitle(section.key)}
                action={section.totals.length > 0 ? (
                  <Text style={[t.type.label, { color: t.color.textMuted }]}>
                    {section.totals.map((tot) => formatMoney(tot.amount, currencyOf(currencies ?? [], tot.currencyCode ?? ''))).join(' · ')}
                  </Text>
                ) : undefined}
              />
            )}
            renderItem={renderItem}
            ListFooterComponent={(
              <>
                {!reachedRealEnd && (
                  <Text style={[t.type.label, { color: t.color.textFaint, textAlign: 'center', paddingVertical: t.space.lg }]}>
                    {loadingMore || loadingOlder ? tr('activity.loadingMore') : ' '}
                  </Text>
                )}
                {remoteSearch.status === 'loading' && (
                  <Text style={[t.type.label, { color: t.color.textFaint, textAlign: 'center', paddingVertical: t.space.lg }]}>
                    {tr('activity.searching')}
                  </Text>
                )}
                {remoteSearch.status === 'offline' && (
                  <Text style={[t.type.label, { color: t.color.textFaint, textAlign: 'center', paddingVertical: t.space.lg }]}>
                    {tr('activity.searchOffline')}
                  </Text>
                )}
                {remoteSearch.status === 'error' && (
                  <Text style={[t.type.label, { color: t.color.warn, textAlign: 'center', paddingVertical: t.space.lg }]}>
                    {tr('activity.searchFailed')}
                  </Text>
                )}
                {remoteSearch.status === 'done' && remoteSearch.rows.length === 0 && (
                  <Text style={[t.type.label, { color: t.color.textFaint, textAlign: 'center', paddingVertical: t.space.lg }]}>
                    {tr('activity.nothingMore')}
                  </Text>
                )}
              </>
            )}
          />
        )}

        <CaptureDock />
      </View>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={tr('activity.title')}>
        <Row first label={tr('count.title')} chevron onPress={() => { setMenuOpen(false); navigateOnce('/count'); }} />
      </Sheet>
    </Screen>
  );
}

const ActivityRow = memo(function ActivityRow({
  item, selecting, selected, currencies, onPress, onLongPress,
}: {
  item: ActivityItem;
  selecting: boolean;
  selected: boolean;
  currencies: Currencies | undefined;
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
  const description = item.description || (item.type === 'withdrawal' ? item.destinationName : item.sourceName) || '—';
  const accountLeg = item.type === 'deposit' ? item.sourceName : item.destinationName;
  const dotColor = item.categoryName ? categoryColor(item.categoryName, t.dark) : (item.type === 'transfer' ? t.color.transfer : t.color.textFaint);
  const selectable = !queued && !remote;
  return (
    <Pressable
      onPress={() => onPress(item)}
      onLongPress={selectable ? () => onLongPress(item) : undefined}
      // 500ms by default, which felt like the long-press hadn't registered.
      delayLongPress={300}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: t.space.sm,
        paddingHorizontal: t.space.lg, paddingVertical: t.space.sm, opacity: pressed ? 0.6 : 1,
        backgroundColor: selected ? t.color.accentSoft : undefined,
      })}
    >
      {selecting && selectable
        ? <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={selected ? t.color.accent : t.color.textFaint} />
        : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />}
      <View style={{ flex: 1 }}>
        <Text style={[t.type.body, { color: t.color.text }]} numberOfLines={1}>{description}</Text>
        <Text style={[t.type.label, { color: t.color.textMuted }]} numberOfLines={1}>
          {[item.categoryName, accountLeg].filter(Boolean).join(' · ') || (queued ? tr('draft.queued') : '—')}
        </Text>
      </View>
      {queued && <Chip label={tr('draft.queued')} tone="warn" />}
      {!!pendingStatus && <Chip label={tr(PENDING_LABEL_KEYS[pendingStatus])} tone="warn" />}
      <Money amount={item.amount} currency={currencyOf(currencies ?? [], item.currencyCode)} type={item.type} />
    </Pressable>
  );
});
