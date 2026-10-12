// Liabilities (loans, debts, mortgages) in FF3's order — Settings → Liabilities. Tap one to open its
// page (app/accounts/[id].tsx); + creates one (app/accounts/new.tsx with type=liability). Asset
// accounts stay on Settings → Accounts.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Text, View } from 'react-native';
import { SearchField } from '../../src/ui/SearchField';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  AppBar,
  BarRow,
  BarIconButton,
  Card,
  Chip,
  SCREEN_TOP_PADDING,
} from '../../src/ui/components';
import {
  useLiabilityAccounts,
  type ReferenceAccountRow,
} from '../../src/accounts/useAssetAccounts';
import { filterAccounts } from '../../src/accounts/filterAccounts';
import { navigateOnce } from '../../src/ui/navigateOnce';
import { PendingDot } from '../../src/ui/PendingDot';
import { usePendingAccountIds } from '../../src/accounts/usePendingAccountIds';

const EMPTY_ACCOUNTS: ReferenceAccountRow[] = [];

export default function LiabilitiesScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const pendingAccounts = usePendingAccountIds();
  // In FF3's own order, inactive ones included so the user can see and reopen them.
  const allLiabilities = useLiabilityAccounts({ includeInactive: true }) ?? EMPTY_ACCOUNTS;
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(true);

  const shown = useMemo(
    () => (showInactive ? allLiabilities : allLiabilities.filter((a) => a.active)),
    [allLiabilities, showInactive],
  );
  const visible = useMemo(() => filterAccounts(shown, search), [shown, search]);

  const row = (item: ReferenceAccountRow) => (
    <Card
      onPress={() => navigateOnce(`/accounts/${item.id}`)}
      style={item.active ? undefined : { opacity: 0.5 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        <PendingDot visible={pendingAccounts.has(item.id)} />
        <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>
          {item.name}
        </Text>
        {!item.active && <Chip label={tr('accounts.inactive')} />}
        <Text style={[t.type.body, { color: t.color.textFaint }]}>›</Text>
      </View>
    </Card>
  );

  return (
    <Screen bottom>
      {searchOpen ? (
        <BarRow>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={tr('pickers.searchAccounts')}
            autoFocus
            onClear={() => {
              setSearch('');
              setSearchOpen(false);
            }}
            style={{ flex: 1 }}
          />
        </BarRow>
      ) : (
        <AppBar
          title={tr('liabilities.title')}
          right={
            <>
              <BarIconButton
                icon="add"
                label={tr('liabilities.newLiability')}
                onPress={() =>
                  navigateOnce({ pathname: '/accounts/new', params: { type: 'liability' } })
                }
              />
              <BarIconButton
                icon="search"
                label={tr('pickers.searchAccounts')}
                onPress={() => setSearchOpen(true)}
              />
              <BarIconButton
                icon={showInactive ? 'eye' : 'eye-off'}
                label={showInactive ? tr('accounts.hideInactive') : tr('accounts.showInactive')}
                onPress={() => setShowInactive((v) => !v)}
              />
            </>
          }
        />
      )}
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
        ListEmptyComponent={
          <Text
            style={[
              t.type.body,
              { color: t.color.textFaint, textAlign: 'center', paddingTop: t.space.xl },
            ]}
          >
            {allLiabilities.length > 0 && !showInactive
              ? tr('accounts.allInactiveHidden')
              : tr('liabilities.empty')}
          </Text>
        }
      />
    </Screen>
  );
}
