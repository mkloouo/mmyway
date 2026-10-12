// Asset accounts in FF3's order (design §6.6). Tap or long-press one to open its page
// (app/accounts/[id].tsx); Reorder turns the list into a drag list, and Done saves it.
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text } from 'react-native';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useCurrencies } from '../../src/db/useReferenceData';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, Button, Card, SCREEN_TOP_PADDING, SectionHeader } from '../../src/ui/components';
import { AccountCard, AccountListBar, AccountListEmpty } from '../../src/accounts/AccountList';
import { DragList } from '../../src/ui/DragList';
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
  const currencies = useCurrencies();
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

  const row = (item: ReferenceAccountRow, index: number) => (
    <AccountCard
      account={item}
      currencies={currencies}
      pending={pendingAccounts.has(item.id)}
      reordering={reordering}
      first={index === 0}
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
        {reordering && (
          <Button title={tr('common.done')} variant="ghost" size="bar" onPress={done} />
        )}
      </AccountListBar>
      {/* Reorder swaps both the line under the bar and the list itself. Each side fades in on
          its own (the old one just goes): two of them animating at once would both claim the
          space for the length of the fade, and the list would jump as they handed it over. The
          keys are what makes React mount a new one, so `entering` runs at all. */}
      {reordering ? (
        <Animated.View key="drag" entering={FadeIn.duration(FADE_MS)} style={{ flex: 1 }}>
          <GestureScrollView
            contentContainerStyle={{ paddingTop: SCREEN_TOP_PADDING, paddingBottom: t.space.lg }}
          >
            <SectionHeader first title={tr('accounts.listTitle')} />
            <Text
              style={[
                t.type.label,
                {
                  color: t.color.textMuted,
                  marginHorizontal: t.space.lg,
                  paddingBottom: t.space.sm,
                },
              ]}
            >
              {tr('accounts.reorderHint')}
            </Text>
            {visible.length === 0 ? (
              empty
            ) : (
              <Card flush style={{ marginHorizontal: t.space.lg }}>
                <DragList
                  items={visible}
                  keyOf={(a) => a.id}
                  renderItem={row}
                  onMove={move}
                  gap={0}
                  moveLabels={{ up: tr('accounts.moveUp'), down: tr('accounts.moveDown') }}
                />
              </Card>
            )}
          </GestureScrollView>
        </Animated.View>
      ) : (
        <Animated.View key="browse" entering={FadeIn.duration(FADE_MS)} style={{ flex: 1 }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingTop: SCREEN_TOP_PADDING, paddingBottom: t.space.lg }}
          >
            <SectionHeader
              first
              title={tr('accounts.listTitle')}
              action={
                <Button
                  title={tr('accounts.reorderAction')}
                  variant="ghost"
                  size="bar"
                  accessibilityLabel={tr('accounts.reorder')}
                  style={{ paddingHorizontal: 0 }}
                  onPress={() => {
                    setDraft(allAccounts.map((a) => a.id));
                    setSearch('');
                    setSearchOpen(false);
                  }}
                />
              }
            />
            {visible.length === 0 ? (
              empty
            ) : (
              <Card flush style={{ marginHorizontal: t.space.lg }}>
                {visible.map((item, i) => (
                  <Fragment key={item.id}>{row(item, i)}</Fragment>
                ))}
              </Card>
            )}
          </ScrollView>
        </Animated.View>
      )}
    </Screen>
  );
}
