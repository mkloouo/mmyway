// Asset accounts in FF3's order (design §6.6). Tap or long-press one to open its page
// (app/accounts/[id].tsx); Reorder turns the list into a drag list, and Done saves it.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Text } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, BarIconButton, Chip, Button, SCREEN_TOP_PADDING } from '../../src/ui/components';
import { AccountCard, AccountListBar, AccountListEmpty } from '../../src/accounts/AccountList';
import { DragList } from '../../src/ui/DragList';
import { hasEnvelopeMarker } from '../../src/accounts/envelopeMarker';
import { useAssetAccounts, type ReferenceAccountRow } from '../../src/accounts/useAssetAccounts';
import { reorderAccounts } from '../../src/accounts/accountActions';
import { filterAccounts } from '../../src/accounts/filterAccounts';
import { applyVisibleOrder } from '../../src/accounts/moveAccount';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { useAction } from '../../src/ui/useAction';
import { usePendingAccountIds } from '../../src/accounts/usePendingAccountIds';

const FADE_MS = 160;
const EMPTY_ACCOUNTS: ReferenceAccountRow[] = [];

export default function AccountsScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const pendingAccounts = usePendingAccountIds();
  // In FF3's own order — the order every account picker in the app uses, set with Reorder.
  const allAccounts = useAssetAccounts({ includeInactive: true }) ?? EMPTY_ACCOUNTS;
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // Every account id in the order the user is dragging them into, or null when not reordering.
  // Nothing is sent until Done: FF3 is given the whole list at once (src/accounts/accountActions.ts).
  const [draft, setDraft] = useState<string[] | null>(null);
  const reordering = draft !== null;
  // Hiding inactive accounts makes a reorder quicker on a long list; they keep their places.
  const [showInactive, setShowInactive] = useState(true);

  const byId = useMemo(() => new Map(allAccounts.map((a) => [a.id, a])), [allAccounts]);
  // While reordering, the draft order wins over the live query's; an account a sync added
  // meanwhile (not in the draft) goes at the end rather than disappearing.
  const ordered = useMemo(
    () =>
      draft
        ? [
            ...draft.flatMap((id) => byId.get(id) ?? []),
            ...allAccounts.filter((a) => !draft.includes(a.id)),
          ]
        : allAccounts,
    [allAccounts, byId, draft],
  );
  const shown = useMemo(
    () => (showInactive ? ordered : ordered.filter((a) => a.active)),
    [ordered, showInactive],
  );
  const visible = useMemo(
    () => (reordering ? shown : filterAccounts(shown, search)),
    [reordering, search, shown],
  );

  // The drag rearranges the accounts on screen; the hidden ones keep their slots in the full list.
  function move(from: number, to: number) {
    const ids = visible.map((a) => a.id);
    const [moved] = ids.splice(from, 1);
    if (!moved) return;
    ids.splice(to, 0, moved);
    setDraft(
      applyVisibleOrder(
        ordered.map((a) => a.id),
        ids,
      ),
    );
  }

  const done = act(tr('accounts.reorder'), async () => {
    const next = draft;
    setDraft(null);
    // Done with nothing dragged sends nothing. Compared with the order on screen, not with FF3's
    // `order` numbers: those have gaps and repeats, so a list FF3 already has in this order used to
    // read as changed and was queued again.
    if (next && next.join() !== allAccounts.map((a) => a.id).join()) {
      await reorderAccounts(db, next);
    }
  });

  const row = (item: ReferenceAccountRow) => (
    <AccountCard
      account={item}
      pending={pendingAccounts.has(item.id)}
      reordering={reordering}
      chips={hasEnvelopeMarker(item.notes) && <Chip label={tr('accounts.envelope')} />}
      onPress={reordering ? undefined : () => navigateOnce(`/accounts/${item.id}`)}
    />
  );

  const empty = (
    <AccountListEmpty
      allHidden={allAccounts.length > 0 && !showInactive}
      emptyText={tr('accounts.empty')}
    />
  );

  return (
    <Screen bottom>
      <AccountListBar
        title={tr('accounts.title')}
        search={search}
        onSearch={setSearch}
        searchOpen={searchOpen}
        onSearchOpen={setSearchOpen}
        showInactive={showInactive}
        onToggleInactive={() => setShowInactive((v) => !v)}
        newLabel={tr('accounts.newAccount')}
        onNew={
          reordering
            ? undefined
            : () => navigateOnce({ pathname: '/accounts/new', params: { type: 'asset' } })
        }
      >
        {reordering ? (
          <Button title={tr('common.done')} variant="ghost" size="bar" onPress={done} />
        ) : (
          <BarIconButton
            icon="swap-vertical"
            label={tr('accounts.reorder')}
            onPress={() => {
              setDraft(allAccounts.map((a) => a.id));
              setSearch('');
              setSearchOpen(false);
            }}
          />
        )}
      </AccountListBar>
      {/* Reorder swaps both the line under the bar and the list itself. Each side fades in on
          its own (the old one just goes): two of them animating at once would both claim the
          space for the length of the fade, and the list would jump as they handed it over. The
          keys are what makes React mount a new one, so `entering` runs at all. */}
      {reordering ? (
        <Animated.View key="drag" entering={FadeIn.duration(FADE_MS)} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{
              padding: t.space.lg,
              paddingTop: SCREEN_TOP_PADDING,
              gap: t.space.sm,
            }}
          >
            <Text style={[t.type.label, { color: t.color.textMuted, paddingBottom: t.space.xs }]}>
              {tr('accounts.reorderHint')}
            </Text>
            {visible.length === 0 ? (
              empty
            ) : (
              <DragList
                items={visible}
                keyOf={(a) => a.id}
                renderItem={row}
                onMove={move}
                gap={t.space.sm}
                moveLabels={{ up: tr('accounts.moveUp'), down: tr('accounts.moveDown') }}
              />
            )}
          </ScrollView>
        </Animated.View>
      ) : (
        <Animated.View key="browse" entering={FadeIn.duration(FADE_MS)} style={{ flex: 1 }}>
          <FlatList
            data={visible}
            keyExtractor={(a) => a.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: t.space.lg,
              paddingTop: SCREEN_TOP_PADDING,
              gap: t.space.sm,
            }}
            renderItem={({ item }) => row(item)}
            ListEmptyComponent={empty}
          />
        </Animated.View>
      )}
    </Screen>
  );
}
