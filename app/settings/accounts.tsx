// Asset accounts in FF3's order (design §6.6). Tap or long-press one to open its page
// (app/accounts/[id].tsx); Reorder turns the list into a drag list, and Done saves it.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDb } from '../../src/providers/DbProvider';
import { SearchField } from '../../src/ui/SearchField';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, BarIconButton, Card, Chip, Button } from '../../src/ui/components';
import { DragList } from '../../src/ui/DragList';
import { hasEnvelopeMarker } from '../../src/accounts/envelopeMarker';
import { useAssetAccounts, type ReferenceAccountRow } from '../../src/accounts/useAssetAccounts';
import { reorderAccounts } from '../../src/accounts/accountActions';
import { filterAccounts } from '../../src/accounts/filterAccounts';
import { applyVisibleOrder } from '../../src/accounts/moveAccount';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { useAction } from '../../src/ui/useAction';
import { PendingDot } from '../../src/ui/PendingDot';
import { usePendingAccountIds } from '../../src/accounts/usePendingAccountIds';

const FADE_MS = 160;

export default function AccountsScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const pendingAccounts = usePendingAccountIds();
  // In FF3's own order — the order every account picker in the app uses, set with Reorder.
  const allAccounts = useAssetAccounts({ includeInactive: true }) ?? [];
  const [search, setSearch] = useState('');
  // Every account id in the order the user is dragging them into, or null when not reordering.
  // Nothing is sent until Done: FF3 is given the whole list at once (src/accounts/accountActions.ts).
  const [draft, setDraft] = useState<string[] | null>(null);
  const reordering = draft !== null;
  const [holding, setHolding] = useState(false);
  // Hiding inactive accounts makes a reorder quicker on a long list; they keep their places.
  const [showInactive, setShowInactive] = useState(true);

  const byId = new Map(allAccounts.map((a) => [a.id, a]));
  // While reordering, the draft order wins over the live query's; an account a sync added
  // meanwhile (not in the draft) goes at the end rather than disappearing.
  const ordered = draft
    ? [
        ...draft.flatMap((id) => byId.get(id) ?? []),
        ...allAccounts.filter((a) => !draft.includes(a.id)),
      ]
    : allAccounts;
  const shown = showInactive ? ordered : ordered.filter((a) => a.active);
  const visible = reordering ? shown : filterAccounts(shown, search);

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
    if (next) await reorderAccounts(db, next);
  });

  const row = (item: ReferenceAccountRow) => (
    <Card
      onPress={reordering ? undefined : () => navigateOnce(`/accounts/${item.id}`)}
      style={item.active ? undefined : { opacity: 0.5 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        <PendingDot visible={pendingAccounts.has(item.id)} />
        <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>
          {item.name}
        </Text>
        {!item.active && <Chip label={tr('accounts.inactive')} />}
        {hasEnvelopeMarker(item.notes) && <Chip label={tr('accounts.envelope')} />}
        {reordering ? (
          <Ionicons name="reorder-three" size={22} color={t.color.accent} />
        ) : (
          <Text style={[t.type.body, { color: t.color.textFaint }]}>›</Text>
        )}
      </View>
    </Card>
  );

  const empty = (
    <Text
      style={[
        t.type.body,
        { color: t.color.textFaint, textAlign: 'center', paddingTop: t.space.xl },
      ]}
    >
      {allAccounts.length > 0 && !showInactive
        ? tr('accounts.allInactiveHidden')
        : tr('accounts.empty')}
    </Text>
  );

  return (
    <Screen bottom>
      <AppBar
        title={tr('accounts.title')}
        right={
          <>
            <BarIconButton
              icon={showInactive ? 'eye-outline' : 'eye-off-outline'}
              label={showInactive ? tr('accounts.hideInactive') : tr('accounts.showInactive')}
              onPress={() => setShowInactive((v) => !v)}
            />
            {reordering ? (
              <Button title={tr('common.done')} variant="ghost" size="bar" onPress={done} />
            ) : (
              <BarIconButton
                icon="swap-vertical"
                label={tr('accounts.reorder')}
                onPress={() => {
                  setDraft(allAccounts.map((a) => a.id));
                  setSearch('');
                }}
              />
            )}
          </>
        }
      />
      {/* Reorder swaps both the line under the bar and the list itself. Each side fades in on
          its own (the old one just goes): two of them animating at once would both claim the
          space for the length of the fade, and the list would jump as they handed it over. The
          keys are what makes React mount a new one, so `entering` runs at all. */}
      {reordering ? (
        <Animated.Text
          key="hint"
          entering={FadeIn.duration(FADE_MS)}
          style={[t.type.label, { color: t.color.textMuted, paddingHorizontal: t.space.lg }]}
        >
          {tr('accounts.reorderHint')}
        </Animated.Text>
      ) : (
        <Animated.View
          key="search"
          entering={FadeIn.duration(FADE_MS)}
          style={{ paddingHorizontal: t.space.lg }}
        >
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={tr('pickers.searchAccounts')}
          />
        </Animated.View>
      )}
      {reordering ? (
        <Animated.View key="drag" entering={FadeIn.duration(FADE_MS)} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: t.space.lg }} scrollEnabled={!holding}>
            {visible.length === 0 ? (
              empty
            ) : (
              <DragList
                items={visible}
                keyOf={(a) => a.id}
                renderItem={row}
                onMove={move}
                onDragChange={setHolding}
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
            contentContainerStyle={{ padding: t.space.lg, gap: t.space.sm }}
            renderItem={({ item }) => row(item)}
            ListEmptyComponent={empty}
          />
        </Animated.View>
      )}
    </Screen>
  );
}
