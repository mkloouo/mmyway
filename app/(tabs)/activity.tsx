// Activity (design §6.4) — balances, grouped-by-day history with totals, paging, search.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, View } from 'react-native';
import { Collapsible, leaveThen } from '../../src/ui/Collapsible';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useCurrencies } from '../../src/db/useReferenceData';
import { useDb } from '../../src/providers/DbProvider';
import { EmptyState, ListRow, Screen, Sheet } from '../../src/ui/kit';
import { CaptureDock } from '../../src/ui/CaptureDock';
import {
  useTransactionPage,
  type ActivityTypeFilter,
} from '../../src/transactions/useTransactionPage';
import { useLoadOlderHistory, usePullToRefresh } from '../../src/sync/useSync';
import { useAssetAccounts, type ReferenceAccountRow } from '../../src/accounts/useAssetAccounts';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { confirmDestructive } from '../../src/ui/confirm';
import { cacheRemoteResult } from '../../src/transactions/remoteSearch';
import { deleteCachedTransactions } from '../../src/sync/outbox';
import { haptics } from '../../src/ui/haptics';
import { useAction } from '../../src/ui/useAction';
import { usePendingAccountIds } from '../../src/accounts/usePendingAccountIds';
import {
  REMOTE_SECTION_KEY,
  type ActivityItem,
  type DisplaySection,
  type RemoteResultRow,
} from '../../src/transactions/activityRows';
import { useRemoteSearch } from '../../src/transactions/useRemoteSearch';
import { ActivityRow, DayHeader } from '../../src/ui/ActivityRows';
import { useSelection } from '../../src/ui/useSelection';
import { useHasSyncedBefore } from '../../src/sync/useHasSyncedBefore';
import { FILTERS } from '../../src/transactions/activityFilters';
import { useActivityRows } from '../../src/transactions/useActivityRows';
import { buildDisplaySections, getSearchFooter } from '../../src/transactions/buildDisplaySections';
import { ActivityListHeader } from '../../src/ui/ActivityListHeader';
import { ActivityListFooter } from '../../src/ui/ActivityListFooter';
import { ActivityFilterSheet } from '../../src/ui/ActivityFilterSheet';
import { ActivityHeader } from '../../src/ui/ActivityHeader';
import { ActivitySelectionBar } from '../../src/ui/ActivitySelectionBar';

const EMPTY_ACCOUNTS: ReferenceAccountRow[] = [];

export default function ActivityScreen() {
  const db = useDb();
  const { t: tr } = useTranslation();
  const act = useAction();
  const pendingAccounts = usePendingAccountIds();
  const navigation = useNavigation<{
    addListener: (event: 'tabPress', cb: () => void) => () => void;
    isFocused: () => boolean;
  }>();
  const listRef = useRef<SectionList<ActivityItem, DisplaySection>>(null);

  const [type, setType] = useState<ActivityTypeFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<string | null>(null);

  const { account: accountParam, at } = useLocalSearchParams<{ account?: string; at?: string }>();
  const paramTap = accountParam ? `${accountParam}@${at ?? ''}` : undefined;
  const [seenParamTap, setSeenParamTap] = useState<string | undefined>(undefined);
  if (paramTap !== seenParamTap) {
    setSeenParamTap(paramTap);
    if (accountParam) setAccountFilter(accountParam);
  }

  const rawAssetAccounts = useAssetAccounts();
  const assetAccounts = rawAssetAccounts ?? EMPTY_ACCOUNTS;
  const currencies = useCurrencies();
  const hasSyncedBefore = useHasSyncedBefore();

  const { sections, dataKey, loadMore, loadingMore, atEnd } = useTransactionPage({
    search,
    type,
    accountId: accountFilter,
  });
  const { loadOlder, loadingOlder, exhausted, reset: resetExhausted } = useLoadOlderHistory();

  function handleEndReached() {
    if (!atEnd) {
      loadMore();
      return;
    }
    if (!exhausted) void loadOlder();
  }
  const reachedRealEnd = atEnd && exhausted;
  const pull = usePullToRefresh(resetExhausted);

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
    leaveThen(ids, setLeavingIds, () => deleteCachedTransactions(db, ids));
  });

  const openRemote = useMemo(
    () =>
      act(tr('activity.search'), async (item: RemoteResultRow) => {
        if (!(await cacheRemoteResult(db, item.group))) return;
        navigateOnce(`/transactions/${item.groupId}`);
      }),
    [act, db, tr],
  );

  const remoteSearch = useRemoteSearch(reachedRealEnd ? search.trim() : '', {
    type,
    accountId: accountFilter,
  });

  const { queuedRows, pendingDeletes, edits, sentItems, cacheFacts, rowKey } = useActivityRows();

  const remoteRows = remoteSearch.status === 'done' ? remoteSearch.rows : null;
  const displaySections = useMemo(
    () =>
      buildDisplaySections({
        sections,
        queuedRows,
        sentItems,
        cacheFacts,
        pendingDeletes,
        edits,
        rowKey,
        type,
        accountFilter,
        search,
        remoteRows,
      }),
    [
      sections,
      queuedRows,
      sentItems,
      cacheFacts,
      pendingDeletes,
      edits,
      rowKey,
      type,
      accountFilter,
      search,
      remoteRows,
    ],
  );

  const hasRemoteSection = displaySections.some((s) => s.key === REMOTE_SECTION_KEY);
  const searchFooter = getSearchFooter(remoteSearch.status, hasRemoteSection);

  const onRowPress = useCallback(
    (item: ActivityItem) => {
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
    ({ item, index, section }: { item: ActivityItem; index: number; section: DisplaySection }) => (
      <Collapsible collapsed={leavingIds.has(item.groupId)}>
        <ActivityRow
          item={item}
          selecting={selecting}
          selected={selectedIds.has(item.groupId)}
          currencies={currencies}
          onPress={onRowPress}
          onLongPress={onRowLongPress}
          isFirst={index === 0}
          isLast={index === section.data.length - 1}
        />
      </Collapsible>
    ),
    [selecting, selectedIds, currencies, onRowPress, onRowLongPress, leavingIds],
  );

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

  const hasResults = displaySections.length > 0;
  const activeFilterCount = (type !== 'all' ? 1 : 0) + (accountFilter !== null ? 1 : 0);
  const isFiltered = activeFilterCount > 0;
  const selectedAccount = assetAccounts.find((a) => a.id === accountFilter);
  const activeType = FILTERS.find((f) => f.type === type);
  const typeSubtitle = type !== 'all' && activeType ? tr(activeType.labelKey) : null;
  const activeFilterSubtitle = [selectedAccount?.name, typeSubtitle].filter(Boolean).join(' · ');

  const clearFilters = useCallback(() => {
    setAccountFilter(null);
    setType('all');
  }, []);

  const closeSearch = useCallback(() => {
    setSearch('');
    setSearchOpen(false);
  }, []);

  const listHeader = useMemo(
    () => (
      <ActivityListHeader
        assetAccounts={assetAccounts}
        accountFilter={accountFilter}
        onToggleAccountFilter={toggleAccountFilter}
        currencies={currencies}
        pendingAccounts={pendingAccounts}
        type={type}
        onSelectType={setType}
      />
    ),
    [assetAccounts, accountFilter, toggleAccountFilter, currencies, pendingAccounts, type],
  );

  const listFooter = useMemo(
    () => (
      <ActivityListFooter
        reachedRealEnd={reachedRealEnd}
        loadingMore={loadingMore}
        loadingOlder={loadingOlder}
        searchFooter={searchFooter}
      />
    ),
    [reachedRealEnd, loadingMore, loadingOlder, searchFooter],
  );

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <ActivityHeader
          selecting={selecting}
          selectedCount={selectedIds.size}
          onClearSelection={clearSelection}
          searchOpen={searchOpen}
          search={search}
          onChangeSearch={setSearch}
          onCloseSearch={closeSearch}
          isFiltered={isFiltered}
          activeFilterSubtitle={activeFilterSubtitle}
          onClearFilters={clearFilters}
          onOpenSearch={() => setSearchOpen(true)}
          activeFilterCount={activeFilterCount}
          onOpenFilter={() => setFilterOpen(true)}
          onOpenMenu={() => setMenuOpen(true)}
        />

        {!hasResults && listHeader}

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
            key={dataKey}
            ref={listRef}
            style={{ flex: 1 }}
            sections={displaySections}
            keyExtractor={rowKey}
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            // eslint-disable-next-line no-restricted-syntax -- kit-exception: dock clearance (MKL-81)
            contentContainerStyle={{ paddingBottom: 140 }}
            ListHeaderComponent={listHeader}
            renderSectionHeader={renderSectionHeader}
            renderItem={renderItem}
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={7}
            ListFooterComponent={listFooter}
          />
        )}

        {selecting ? (
          <ActivitySelectionBar selectedCount={selectedIds.size} onDelete={deleteSelected} />
        ) : (
          <CaptureDock />
        )}
      </View>

      <ActivityFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        type={type}
        onChangeType={setType}
        accountFilter={accountFilter}
        onSelectAccount={setAccountFilter}
        onClearFilters={clearFilters}
        assetAccounts={assetAccounts}
        pendingAccounts={pendingAccounts}
        transactionCount={displaySections.reduce((s, sec) => s + sec.data.length, 0)}
      />

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={tr('activity.title')}>
        <ListRow
          first
          label={tr('count.title')}
          icon="cash"
          onPress={() => {
            setMenuOpen(false);
            navigateOnce('/count');
          }}
        />
      </Sheet>
    </Screen>
  );
}
