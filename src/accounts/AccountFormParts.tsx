// What the account page (app/accounts/[id].tsx) and New account (app/accounts/new.tsx) share: the
// amount field, the scroll, the currency and role sheets, and how a day is labelled and picked.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View, type KeyboardTypeOptions } from 'react-native';
import { fullDay } from '../utils/dates';
import {
  Button,
  Card,
  ChoiceCard,
  FieldRow,
  SCREEN_TOP_PADDING,
  SectionHeader,
  SwitchRow,
} from '../ui/kit';
import { pickableCurrencies } from '../money/currencies';
import { pickDate } from '../ui/pickDate';
import { PickerSheet } from '../ui/PickerSheet';
import { TextField } from '../ui/TextField';
import { useTheme } from '../ui/theme';
import { dayDate, localDay } from '../utils/day';
import { ACCOUNT_ROLES, type AccountRole } from './accountEdit';

export const ROLE_LABEL_KEYS: Record<AccountRole, string> = {
  defaultAsset: 'account.roleDefault',
  sharedAsset: 'account.roleShared',
  savingAsset: 'account.roleSaving',
  ccAsset: 'account.roleCreditCard',
  cashWalletAsset: 'account.roleCashWallet',
};

export function dayLabel(day: string | null): string | null {
  return day ? fullDay(day) : null;
}

export function pickDay(value: string | null, onPick: (day: string) => void) {
  pickDate(value ? dayDate(value) : new Date(), (picked) => onPick(localDay(picked)));
}

/** A label and its input on one line of a Group; the input takes the rest, its text right-aligned. */
export function InlineField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  first = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  /** No hairline above: the first row of its group. */
  first?: boolean;
}) {
  return (
    <FieldRow
      label={label}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      multiline={multiline}
      first={first}
    />
  );
}

/** An amount kept as typed, with the "not an amount" line under it once `parsed` says so. */
export function AmountField({
  label,
  text,
  onChangeText,
  parsed,
  keyboardType = 'numeric',
  spaced = false,
}: {
  label: string;
  text: string;
  onChangeText: (text: string) => void;
  parsed: { ok: boolean } | null;
  keyboardType?: KeyboardTypeOptions;
  /** Extra room above the label, for a field that follows a row rather than a heading. */
  spaced?: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <>
      <Text
        style={[t.type.label, { color: t.color.textMuted }, spaced && { marginTop: t.space.sm }]}
      >
        {label}
      </Text>
      <TextField
        value={text}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder="0"
      />
      {!!parsed && !parsed.ok && (
        <Text style={[t.type.label, { color: t.color.danger }]}>{tr('common.invalidAmount')}</Text>
      )}
    </>
  );
}

export function FormScroll({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: t.space.xl, paddingTop: SCREEN_TOP_PADDING }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function CurrencySheet({
  visible,
  onClose,
  currencies,
  selected,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  currencies: Parameters<typeof pickableCurrencies>[0];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const { t: tr } = useTranslation();
  return (
    <PickerSheet
      visible={visible}
      onClose={onClose}
      title={tr('fields.currency')}
      options={pickableCurrencies(currencies, selected).map((c) => ({
        key: c.code,
        label: c.code,
      }))}
      selected={selected}
      onSelect={(code) => code && onSelect(code)}
    />
  );
}

export function RoleSheet({
  visible,
  onClose,
  selected,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  selected: AccountRole | undefined;
  onSelect: (role: AccountRole) => void;
}) {
  const { t: tr } = useTranslation();
  return (
    <PickerSheet
      visible={visible}
      onClose={onClose}
      title={tr('account.role')}
      options={ACCOUNT_ROLES.map((role) => ({ key: role, label: tr(ROLE_LABEL_KEYS[role]) }))}
      selected={selected}
      onSelect={(role) => role && onSelect(role as AccountRole)}
    />
  );
}

/** A "what kind" card: a radio in the group, 2 px accent border and accentSoft fill when selected. */
export function KindCard({
  testID,
  icon,
  label,
  sub,
  selected,
  onPress,
}: {
  testID: string;
  icon: 'card-outline' | 'trending-down-outline';
  label: string;
  sub: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <ChoiceCard
      testID={testID}
      icon={icon}
      label={label}
      sub={sub}
      selected={selected}
      onPress={onPress}
    />
  );
}

export function AccountActionButtons({
  liability,
  onCountCash,
  onTransactions,
}: {
  liability: boolean;
  onCountCash: () => void;
  onTransactions: () => void;
}) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: t.space.sm,
        paddingHorizontal: t.space.lg,
        paddingBottom: t.space.sm,
      }}
    >
      {!liability && (
        <Button
          title={tr('count.title')}
          variant="secondary"
          style={{ flex: 1 }}
          onPress={onCountCash}
        />
      )}
      <Button
        title={tr('account.transactions')}
        variant="secondary"
        style={{ flex: 1 }}
        onPress={onTransactions}
      />
    </View>
  );
}

export function AccountWhereCard({
  liability,
  active,
  onActiveChange,
  envelope,
  onEnvelopeChange,
  includeNetWorth,
  onIncludeNetWorthChange,
}: {
  liability: boolean;
  active: boolean;
  onActiveChange: (v: boolean) => void;
  envelope: boolean;
  onEnvelopeChange: (v: boolean) => void;
  includeNetWorth: boolean;
  onIncludeNetWorthChange: () => void;
}) {
  const { t: tr } = useTranslation();
  const t = useTheme();
  return (
    <>
      <SectionHeader title={tr('account.sectionWhere')} />
      <Card flush style={{ marginHorizontal: t.space.lg }}>
        <SwitchRow
          first
          value={active}
          onValueChange={() => onActiveChange(!active)}
          label={tr('accounts.active')}
          hint={tr('accounts.activeHint')}
        />
        {!liability && (
          <SwitchRow
            value={envelope}
            onValueChange={() => onEnvelopeChange(!envelope)}
            label={tr('accounts.cashEnvelope')}
            hint={tr('accounts.cashEnvelopeHint')}
          />
        )}
        {!liability && (
          <SwitchRow
            value={includeNetWorth}
            onValueChange={onIncludeNetWorthChange}
            label={tr('account.includeNetWorth')}
            hint={tr('account.includeNetWorthHint')}
          />
        )}
      </Card>
    </>
  );
}
