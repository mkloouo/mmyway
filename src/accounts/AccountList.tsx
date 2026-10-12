// What Settings → Accounts and Settings → Liabilities share: one account's card, the bar with search,
// the show-inactive eye and +, and the empty-list line. The accounts list adds Reorder to the bar.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppBar, BarIconButton, BarRow, Card, Chip } from '../ui/components';
import { PendingDot } from '../ui/PendingDot';
import { SearchField } from '../ui/SearchField';
import { useTheme } from '../ui/theme';
import type { ReferenceAccountRow } from './useAssetAccounts';

export function AccountCard({
  account,
  pending,
  reordering = false,
  chips,
  onPress,
}: {
  account: ReferenceAccountRow;
  pending: boolean;
  reordering?: boolean;
  /** Extra chips after "Inactive", e.g. the cash-envelope one. */
  chips?: ReactNode;
  onPress?: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <Card onPress={onPress} style={account.active ? undefined : { opacity: 0.5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        <PendingDot visible={pending} />
        <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>
          {account.name}
        </Text>
        {!account.active && <Chip label={tr('accounts.inactive')} />}
        {chips}
        {reordering ? (
          <Ionicons name="reorder-three" size={22} color={t.color.accent} />
        ) : (
          <Text style={[t.type.body, { color: t.color.textFaint }]}>›</Text>
        )}
      </View>
    </Card>
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
      <BarRow>
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
      </BarRow>
    );
  }
  return (
    <AppBar
      title={title}
      right={
        <>
          {onNew && <BarIconButton icon="add" label={newLabel} onPress={onNew} />}
          <BarIconButton
            icon="search"
            label={tr('pickers.searchAccounts')}
            onPress={() => onSearchOpen(true)}
          />
          <BarIconButton
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
