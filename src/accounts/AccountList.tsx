// What Settings → Accounts and Settings → Liabilities share: one account's card, the bar with search,
// the show-inactive eye and +, and the empty-list line. The accounts list adds Reorder to the bar.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { IconButton, ListRow, Money, TabHeader, Tile, type TileTone } from '../ui/kit';
import { currencyOf } from '../money/format';
import { PendingDot } from '../ui/PendingDot';
import { SearchField } from '../ui/SearchField';
import { useTheme } from '../ui/theme';
import { formFromAccount } from './accountEdit';
import { ROLE_LABEL_KEYS } from './AccountFormParts';
import { hasEnvelopeMarker } from './envelopeMarker';
import type { ReferenceAccountRow } from './useAssetAccounts';

/** The tile an account wears and the words under its name: its kind, or its role. */
export function accountKind(account: ReferenceAccountRow): {
  icon: keyof typeof Ionicons.glyphMap;
  tone: TileTone;
  labelKey: string;
} {
  if (account.type === 'liability')
    return { icon: 'trending-down-outline', tone: 'danger', labelKey: 'account.typeLiability' };
  if (hasEnvelopeMarker(account.notes))
    return { icon: 'wallet-outline', tone: 'warn', labelKey: 'accounts.cashEnvelope' };
  const role = formFromAccount(account).accountRole;
  if (role === 'savingAsset')
    return { icon: 'cash-outline', tone: 'income', labelKey: ROLE_LABEL_KEYS[role] };
  return { icon: 'card-outline', tone: 'accent', labelKey: ROLE_LABEL_KEYS[role] };
}

/** One account as a row of the list's Card. Inactive accounts say so where the kind would be. */
export function AccountCard({
  account,
  currencies,
  pending,
  reordering = false,
  first = false,
  onPress,
}: {
  account: ReferenceAccountRow;
  currencies: Parameters<typeof currencyOf>[0];
  pending: boolean;
  reordering?: boolean;
  /** The first row of its Card: no hairline above it. */
  first?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const kind = accountKind(account);
  // The trailing slot is either the balance or the chevron, never both; a reorder shows its handle.
  const balance = account.currentBalance;
  return (
    <ListRow
      first={first}
      label={account.name}
      sub={account.active ? tr(kind.labelKey) : tr('accounts.inactive')}
      leading={<Tile icon={kind.icon} tone={kind.tone} />}
      trailing={
        <>
          <PendingDot visible={pending} />
          {reordering ? (
            <Ionicons name="reorder-three" size={22} color={t.color.accent} />
          ) : (
            balance != null && (
              <Money amount={balance} currency={currencyOf(currencies, account.currencyCode)} />
            )
          )}
        </>
      }
      chevron={!reordering && balance == null}
      onPress={onPress}
    />
  );
}

export function AccountListBar({
  title,
  search,
  onSearch,
  searchOpen,
  onSearchOpen,
  showInactive,
  onToggleInactive,
  newLabel,
  onNew,
  children,
}: {
  title: string;
  search: string;
  onSearch: (text: string) => void;
  searchOpen: boolean;
  onSearchOpen: (open: boolean) => void;
  showInactive: boolean;
  onToggleInactive: () => void;
  newLabel: string;
  /** Left out to hide + (while reordering). */
  onNew?: () => void;
  /** More buttons after the eye. */
  children?: ReactNode;
}) {
  const { t: tr } = useTranslation();
  if (searchOpen) {
    return (
      <TabHeader>
        <SearchField
          value={search}
          onChangeText={onSearch}
          placeholder={tr('pickers.searchAccounts')}
          autoFocus
          onClear={() => {
            onSearch('');
            onSearchOpen(false);
          }}
          style={{ flex: 1 }}
        />
      </TabHeader>
    );
  }
  return (
    <TabHeader
      title={title}
      right={
        <>
          {onNew && <IconButton icon="add" label={newLabel} onPress={onNew} />}
          <IconButton
            icon="search"
            label={tr('pickers.searchAccounts')}
            onPress={() => onSearchOpen(true)}
          />
          <IconButton
            icon={showInactive ? 'eye' : 'eye-off'}
            label={showInactive ? tr('accounts.hideInactive') : tr('accounts.showInactive')}
            onPress={onToggleInactive}
          />
          {children}
        </>
      }
    />
  );
}

/** The line an empty list shows: everything hidden as inactive, or nothing synced at all. */
export function AccountListEmpty({
  allHidden,
  emptyText,
}: {
  allHidden: boolean;
  emptyText: string;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <Text
      style={[
        t.type.body,
        { color: t.color.textFaint, textAlign: 'center', paddingTop: t.space.xl },
      ]}
    >
      {allHidden ? tr('accounts.allInactiveHidden') : emptyText}
    </Text>
  );
}
