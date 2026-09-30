// Activity (design §6.4) — balances, grouped-by-day history with totals, paging, search.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, Text, View } from 'react-native';
import { Collapsible, leaveThen } from '../../src/ui/Collapsible';
import { useNavigation } from 'expo-router';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useCurrencies } from '../../src/db/useReferenceData';
import { useDb } from '../../src/providers/DbProvider';
import { SearchField } from '../../src/ui/SearchField';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  AppBar,
  BarRow,
  BarIconButton,
  Chip,
  EmptyState,
  Sheet,
  Row,
  Button,
} from '../../src/ui/components';
import { CaptureDock } from '../../src/ui/CaptureDock';
import {
  useTransactionPage,
  type ActivityTypeFilter,
} from '../../src/transactions/useTransactionPage';
import { useLoadOlderHistory, usePullToRefresh } from '../../src/sync/useSync';
import { outboxOperations, cachedTransactions, inboxItems } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import type { CreateTransactionPayload } from '../../src/sync/outbox';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { confirmDestructive } from '../../src/ui/confirm';
import { cacheRemoteResult } from '../../src/transactions/remoteSearch';
import { deleteCachedTransactions } from '../../src/sync/outbox';
import { and, desc, eq, inArray, isNotNull, max, ne } from 'drizzle-orm';
import { haptics } from '../../src/ui/haptics';
import { pendingEdits, applyPendingEdit } from '../../src/transactions/pendingEdits';
import { payloadGroupId, readPayload } from '../../src/sync/payloadJson';
import { useAction } from '../../src/ui/useAction';
import { usePendingAccountIds } from '../../src/accounts/usePendingAccountIds';
import { landingItems, matchesActivityFilter } from '../../src/transactions/pinnedRows';
import {
  REMOTE_SECTION_KEY,
  landingRow,
  sumAmounts,
  type ActivityCachedRow,
  type ActivityItem,
  type DisplaySection,
  type QueuedRow,
  type RemoteResultRow,
} from '../../src/transactions/activityRows';
import { useRemoteSearch } from '../../src/transactions/useRemoteSearch';
import { ActivityRow, BalanceStrip, DayHeader } from '../../src/ui/ActivityRows';
import { useSelection } from '../../src/ui/useSelection';
import { useHasSyncedBefore } from '../../src/sync/useHasSyncedBefore';
import { localDay } from '../../src/utils/day';

const FILTERS: { labelKey: string; type: ActivityTypeFilter }[] = [
  { labelKey: 'activity.filterAll', type: 'all' },
  { labelKey: 'activity.filterSpending', type: 'withdrawal' },
  { labelKey: 'activity.filterIncome', type: 'deposit' },
  { labelKey: 'activity.filterMoves', type: 'transfer' },
];

export default function ActivityScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const pendingAccounts = usePendingAccountIds();
  // `tabPress` is a bottom-tab event; expo-router doesn't export the tab navigation type from a
  // public path, so the hook is told what this screen uses of it instead of casting afterwards.
  const navigation = useNavigation<{
    addListener: (event: 'tabPress', cb: () => void) => () => void;
    isFocused: () => boolean;
  }>();
  const listRef = useRef<SectionList<ActivityItem, DisplaySection>>(null);

  const [type, setType] = useState<ActivityTypeFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<string | null>(null);

  const assetAccounts = useAssetAccounts() ?? [];
  const currencies = useCurrencies();
  const { data: outbox } = useLiveQuery(
    db.select().from(outboxOperations).where(ne(outboxOperations.kind, 'update_account')),
  );
  const hasSyncedBefore = useHasSyncedBefore();

  const { sections, dataKey, loadMore, loadingMore, atEnd } = useTransactionPage({
    search,
    type,
    accountId: accountFilter,
  });
  const { loadOlder, loadingOlder, exhausted, reset: resetExhausted } = useLoadOlderHistory();
  // The local cache runs out before real history does — reaching the end of what's cached pulls
  // a further chunk from FF3 instead of just stopping (see useLoadOlderHistory).
  function handleEndReached() {
    if (!atEnd) {
      loadMore();
      return;
    }
    if (!exhausted) void loadOlder();
  }
  const reachedRealEnd = atEnd && exhausted;
  // A pull-to-refresh is the user asking "check again" — `exhausted` otherwise only ever latches
  // forward for the lifetime of this screen.
  const pull = usePullToRefresh(resetExhausted);

  // Multi-select (long-press a row): bulk delete, each as its own conflict-checked outbox delete.
  const { selectedIds, selecting, toggleSelected, clearSelection, leavingIds, setLeavingIds } =
    useSelection();
  const deleteSelected = act(tr('common.delete'), async () => {
    const ids = [...selectedIds];
    if (
      !(await confirmDestructive(
        tr('activity.deleteTitle', { count: ids.length }),
        tr('common.delete'),
        tr('activity.deleteBody'),
      ))
    )
      return;
    clearSelection();
    // The rows fold away first, then the deletes are queued (which takes them out of the list).
    leaveThen(ids, setLeavingIds, () => deleteCachedTransactions(db, ids));
  });

  // A FF3 search result isn't in the local cache; store the copy we already have, then open it.
  // Memoized: onRowPress below depends on it, and the rows only stay memoized while that is stable.
  const openRemote = useMemo(
    () =>
      act(tr('activity.search'), async (item: RemoteResultRow) => {
        if (!(await cacheRemoteResult(db, item.group))) return;
        navigateOnce(`/transactions/${item.groupId}`);
      }),
    [act, db, tr],
  );

  // Once local search runs out of cached rows to page through, FF3's own search covers what
  // hasn't been pulled into cachedTransactions yet — kept as a separate section rather than
  // written into the cache, so local search stays a predictable, offline-first read.
  const remoteSearch = useRemoteSearch(reachedRealEnd ? search.trim() : '');

  // Everything read from the outbox, parsed once per outbox change rather than on every render —
  // a selection tap re-renders this screen, and re-parsing every queued payload each time was
  // part of why multi-select lagged.
  const { queuedRows, pendingDeletes, edits } = useMemo(() => {
    const ops = outbox ?? [];
    const queued: QueuedRow[] = ops
      .filter(
        (op) =>
          op.kind === 'create_transaction' &&
          (op.status === 'pending' || op.status === 'in_flight'),
      )
      .map((op): QueuedRow | null => {
        // An unreadable payload fails its own operation (Inbox, Needs attention); it mustn't take
        // the whole list down with it.
        let payload: CreateTransactionPayload;
        try {
          payload = readPayload<CreateTransactionPayload>(op.kind, op.payloadJson);
        } catch {
          return null;
        }
        const split = payload.splits[0];
        if (!split) return null;
        const many = payload.splits.length > 1;
        return {
          queued: true,
          groupId: op.id,
          inboxItemId: op.inboxItemId,
          description: many ? (payload.groupTitle ?? split.description) : split.description,
          amount: many ? sumAmounts(payload.splits) : split.amount,
          currencyCode: split.currency_code ?? '',
          type: split.type,
          sourceId: split.source_id != null ? String(split.source_id) : null,
          destinationId: split.destination_id != null ? String(split.destination_id) : null,
          sourceName: split.source_name ?? null,
          destinationName: split.destination_name ?? null,
          categoryName: many ? null : (split.category_name ?? null),
          splits: many
            ? payload.splits.map((s) => ({
                label: s.category_name || s.description,
                amount: s.amount,
                categoryName: s.category_name ?? null,
              }))
            : [],
        };
      })
      .filter((r): r is QueuedRow => !!r);
    // A queued delete takes the row out right away — it used to sit there, unchanged, until a
    // pull-to-refresh after the delete had gone through.
    const deletes = new Set(
      ops
        .filter((op) => op.kind === 'delete_transaction' && op.status !== 'failed')
        .map((op) => payloadGroupId(op.kind, op.payloadJson))
        .filter((id): id is string => !!id),
    );
    return { queuedRows: queued, pendingDeletes: deletes, edits: pendingEdits(ops) };
  }, [outbox]);

  // Entries the Inbox sent to FF3 lately. A queued row and the synced row that replaces it are
  // listed under one key (the inbox item's), and until the synced copy is in the list the sent
  // entry stays on screen from its draft — it used to vanish between the two.
  const { data: sentItems } = useLiveQuery(
    db
      .select({
        id: inboxItems.id,
        kind: inboxItems.kind,
        draftJson: inboxItems.draftJson,
        ff3GroupId: inboxItems.ff3GroupId,
        updatedAt: inboxItems.updatedAt,
      })
      .from(inboxItems)
      .where(and(eq(inboxItems.state, 'synced'), isNotNull(inboxItems.ff3GroupId)))
      .orderBy(desc(inboxItems.updatedAt))
      .limit(30),
  );
  const inboxByGroup = useMemo(
    () => new Map((sentItems ?? []).map((i) => [i.ff3GroupId!, i.id])),
    [sentItems],
  );
  // Whether a sent entry has reached the cache is asked of the whole cache, never of the filtered
  // list (src/transactions/pinnedRows.ts has the bug this caused).
  const sentGroupIds = (sentItems ?? []).map((i) => i.ff3GroupId!);
  const { data: sentCached } = useLiveQuery(
    db
      .select({ id: cachedTransactions.groupId })
      .from(cachedTransactions)
      .where(inArray(cachedTransactions.groupId, sentGroupIds)),
    [sentGroupIds.join(',')],
  );
  const { data: caughtUpRows } = useLiveQuery(
    db.select({ at: max(cachedTransactions.syncedAt) }).from(cachedTransactions),
  );
  const cacheFacts = useMemo(
    () =>
      sentCached && caughtUpRows
        ? {
            groupIds: new Set(sentCached.map((r) => r.id)),
            caughtUpAt: caughtUpRows[0]?.at ?? null,
          }
        : null,
    [sentCached, caughtUpRows],
  );
  const rowKey = useCallback(
    (row: ActivityItem) => {
      if ('queued' in row) return row.inboxItemId ? `inbox:${row.inboxItemId}` : row.groupId;
      const inboxId = inboxByGroup.get(row.groupId);
      return inboxId ? `inbox:${inboxId}` : row.groupId;
    },
    [inboxByGroup],
  );

  const remoteRows = remoteSearch.status === 'done' ? remoteSearch.rows : null;
  /** What the list's footer says about the FF3-side search, if anything. */
  const searchFooter: { key: string; warn?: boolean } | null =
    remoteSearch.status === 'loading'
      ? { key: 'activity.searching' }
      : remoteSearch.status === 'offline'
        ? { key: 'activity.searchOffline' }
        : remoteSearch.status === 'error'
          ? { key: 'activity.searchFailed', warn: true }
          : remoteSearch.status === 'done' && remoteSearch.rows.length === 0
            ? { key: 'activity.nothingMore' }
            : null;
  const displaySections = useMemo(() => {
    const todayKey = localDay();
    const queuedInbox = new Set(queuedRows.map((r) => r.inboxItemId));
    const landingRows: QueuedRow[] = landingItems(sentItems ?? [], cacheFacts, queuedInbox)
      .map((i) => landingRow(i.id, i.draftJson))
      .filter((r): r is QueuedRow => !!r);
    // Pinned rows follow the same filters as the cached ones: they used to show under every account.
    const filter = { type, accountId: accountFilter, search };
    // The live queries behind the pinned rows and the cached ones update on separate ticks, so
    // for a moment after a send both can hold the same entry — two rows under one key. The cached
    // row wins.
    const cachedKeys = new Set(
      sections
        .flatMap((s) => s.data.map((row) => rowKey(row)))
        .filter((k) => k.startsWith('inbox:')),
    );
    const pinned = [...queuedRows, ...landingRows].filter(
      (row) => !cachedKeys.has(rowKey(row)) && matchesActivityFilter(row, filter),
    );
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
    if (pinned.length > 0) {
      const idx = result.findIndex((s) => s.key === todayKey);
      if (idx >= 0) result[idx] = { ...result[idx]!, data: [...pinned, ...result[idx]!.data] };
      else result.unshift({ key: todayKey, totals: [], data: pinned });
    }
    if (remoteRows && remoteRows.length > 0) {
      result.push({ key: REMOTE_SECTION_KEY, totals: [], data: remoteRows });
    }
    return result;
  }, [
    sections,
    rowKey,
    pendingDeletes,
    edits,
    queuedRows,
    remoteRows,
    sentItems,
    cacheFacts,
    type,
    accountFilter,
    search,
  ]);

  // Rows get callbacks that only change when selection mode starts or ends (when every row
  // re-renders anyway), so a memoized row re-renders only when its own selected state changes —
  // not every row on every tap.
  const onRowPress = useCallback(
    (item: ActivityItem) => {
      // A queued entry isn't in FF3 yet: open it as its Inbox draft, where a still-waiting one can
      // be cancelled.
      if ('queued' in item) {
        if (item.inboxItemId) navigateOnce(`/draft/${item.inboxItemId}`);
        return;
      }
      if (selecting) {
        toggleSelected(item.groupId);
        return;
      }
      if ('remote' in item) {
        void openRemote(item);
        return;
      }
      navigateOnce(`/transactions/${item.groupId}`);
    },
    [selecting, toggleSelected, openRemote],
  );
  const onRowLongPress = useCallback(
    (item: ActivityItem) => {
      void haptics.tick();
      toggleSelected(item.groupId);
    },
    [toggleSelected],
  );
  const renderItem = useCallback(
    ({ item }: { item: ActivityItem }) => (
      <Collapsible collapsed={leavingIds.has(item.groupId)}>
        <ActivityRow
          item={item}
          selecting={selecting}
          selected={selectedIds.has(item.groupId)}
          currencies={currencies}
          onPress={onRowPress}
          onLongPress={onRowLongPress}
        />
      </Collapsible>
    ),
    [selecting, selectedIds, currencies, onRowPress, onRowLongPress, leavingIds],
  );
  // Stable, and the header memoized: an inline one re-rendered every header, each formatting its
  // date again, on every tap on the screen (a filter chip, a balance card, a selection).
  const renderSectionHeader = useCallback(
    ({ section }: { section: DisplaySection }) => (
      <DayHeader sectionKey={section.key} totals={section.totals} currencies={currencies} />
    ),
    [currencies],
  );
  const toggleAccountFilter = useCallback(
    (id: string) => setAccountFilter((cur) => (cur === id ? null : id)),
    [],
  );

  // The listener is added once but reads the current sections through a ref: it used to close
  // over the first render's (empty) list and never scroll.
  const hasSectionsRef = useRef(false);
  useEffect(() => {
    hasSectionsRef.current = displaySections.length > 0;
  }, [displaySections]);
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress', () => {
      if (navigation.isFocused() && hasSectionsRef.current) {
        listRef.current?.scrollToLocation({
          sectionIndex: 0,
          itemIndex: 0,
          animated: true,
          viewOffset: 0,
        });
      }
    });
    return unsubscribe;
  }, [navigation]);

  // undefined until the first read lands, so a synced-but-empty Activity doesn't flash "Nothing
  // cached yet" before flipping to "No results" once the probe resolves.

  const hasResults = displaySections.length > 0;

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {/* Search takes the app bar's place rather than adding a row below it, so opening it
            does not shove the balances and the list down the screen. */}
        {selecting ? (
          <AppBar
            title={tr('inbox.selected', { count: selectedIds.size })}
            left={
              <BarIconButton
                icon="close"
                label={tr('inbox.cancelSelection')}
                onPress={clearSelection}
              />
            }
            right={
              <Button
                title={tr('common.delete')}
                variant="danger"
                size="bar"
                onPress={deleteSelected}
              />
            }
          />
        ) : searchOpen ? (
          <BarRow>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder={tr('activity.searchPlaceholder')}
              autoFocus
              onClear={() => {
                setSearch('');
                setAccountFilter(null);
                setType('all');
                setSearchOpen(false);
              }}
              style={{ flex: 1 }}
            />
          </BarRow>
        ) : (
          <AppBar
            title={tr('activity.title')}
            right={
              <>
                <BarIconButton
                  icon="search"
                  label={tr('activity.search')}
                  onPress={() => setSearchOpen(true)}
                />
                <BarIconButton
                  icon="ellipsis-horizontal"
                  label={tr('capture.more')}
                  onPress={() => setMenuOpen(true)}
                />
              </>
            }
          />
        )}

        {assetAccounts.length > 0 && (
          <BalanceStrip
            accounts={assetAccounts}
            selectedId={accountFilter}
            onToggle={toggleAccountFilter}
            currencies={currencies}
            pendingAccounts={pendingAccounts}
          />
        )}

        <View
          style={{
            flexDirection: 'row',
            paddingHorizontal: t.space.lg,
            gap: t.space.sm,
            paddingBottom: t.space.sm,
          }}
        >
          {FILTERS.map((f) => (
            <Chip
              key={f.type}
              label={tr(f.labelKey)}
              selected={type === f.type}
              onPress={() => setType(f.type)}
            />
          ))}
        </View>

        {hasSyncedBefore === false && !hasResults && (
          <EmptyState
            glyph="↻"
            title={tr('activity.nothingCachedTitle')}
            hint={tr('activity.nothingCachedHint')}
          />
        )}
        {hasSyncedBefore === true && !hasResults && (
          <EmptyState
            glyph="🔍"
            title={tr('activity.noResultsTitle')}
            hint={tr('activity.noResultsHint')}
          />
        )}

        {hasResults && (
          <SectionList<ActivityItem, DisplaySection>
            // A new filter is a new list: without the remount a list scrolled deep into All kept
            // its offset over the much shorter Income list, so onEndReached fired over and over
            // and the list paged (and scrolled) by itself. Keyed by the filter the rows were read
            // for, not the one just picked: that remounted the list over the old rows first, and
            // then again when the new ones landed — twice the work on every account switch.
            key={dataKey}
            ref={listRef}
            style={{ flex: 1 }}
            sections={displaySections}
            keyExtractor={rowKey}
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            contentContainerStyle={{ paddingBottom: 140 }}
            renderSectionHeader={renderSectionHeader}
            renderItem={renderItem}
            // A filter change remounts the list (key above), so what it mounts is what a tap costs.
            // React Native's default window is 21 screens: every one of the 100 rows on a page
            // mounted, in batches, and the switch stuttered through them. A few screens are enough
            // to scroll into; the rest mount as the list moves.
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={7}
            ListFooterComponent={
              <>
                {!reachedRealEnd && (
                  <Text
                    style={[
                      t.type.label,
                      {
                        color: t.color.textFaint,
                        textAlign: 'center',
                        paddingVertical: t.space.lg,
                      },
                    ]}
                  >
                    {loadingMore || loadingOlder ? tr('activity.loadingMore') : ' '}
                  </Text>
                )}
                {searchFooter && (
                  <Text
                    style={[
                      t.type.label,
                      {
                        color: searchFooter.warn ? t.color.warn : t.color.textFaint,
                        textAlign: 'center',
                        paddingVertical: t.space.lg,
                      },
                    ]}
                  >
                    {tr(searchFooter.key)}
                  </Text>
                )}
              </>
            }
          />
        )}

        <CaptureDock />
      </View>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={tr('activity.title')}>
        <Row
          first
          label={tr('count.title')}
          icon="cash-outline"
          onPress={() => {
            setMenuOpen(false);
            navigateOnce('/count');
          }}
        />
      </Sheet>
    </Screen>
  );
}
