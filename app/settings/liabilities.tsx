// Liabilities (loans, debts, mortgages) in FF3's order — Settings → Liabilities. Tap one to open its
// page (app/accounts/[id].tsx); + creates one (app/accounts/new.tsx with type=liability). Asset
// accounts stay on Settings → Accounts.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { useTheme } from '../../src/ui/theme';
import { Screen, SCREEN_TOP_PADDING } from '../../src/ui/components';
import { AccountCard, AccountListBar, AccountListEmpty } from '../../src/accounts/AccountList';
import {
  useLiabilityAccounts,
  type ReferenceAccountRow,
} from '../../src/accounts/useAssetAccounts';
import { filterAccounts } from '../../src/accounts/filterAccounts';
import { navigateOnce } from '../../src/ui/navigateOnce';
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
    <AccountCard
      account={item}
      pending={pendingAccounts.has(item.id)}
      onPress={() => navigateOnce(`/accounts/${item.id}`)}
    />
  );

  return (
    <Screen bottom>
      <AccountListBar
        title={tr('liabilities.title')}
        search={search}
        onSearch={setSearch}
        searchOpen={searchOpen}
        onSearchOpen={setSearchOpen}
        showInactive={showInactive}
        onToggleInactive={() => setShowInactive((v) => !v)}
        newLabel={tr('liabilities.newLiability')}
        onNew={() => navigateOnce({ pathname: '/accounts/new', params: { type: 'liability' } })}
      />
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
          <AccountListEmpty
            allHidden={allLiabilities.length > 0 && !showInactive}
            emptyText={tr('liabilities.empty')}
          />
        }
      />
    </Screen>
  );
}
