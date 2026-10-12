// What the account page (app/accounts/[id].tsx) and New account (app/accounts/new.tsx) share: the
// name and amount fields, the scroll and its titled cards, the currency and role
// sheets, and how a day is labelled and picked.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, type KeyboardTypeOptions } from 'react-native';
import { appLocale } from '../i18n';
import { Card, SCREEN_TOP_PADDING, SectionHeader } from '../ui/components';
import { pickableCurrencies } from '../ui/currencies';
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
  return day
    ? dayDate(day).toLocaleDateString(appLocale(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;
}

export function pickDay(value: string | null, onPick: (day: string) => void) {
  pickDate(value ? dayDate(value) : new Date(), (picked) => onPick(localDay(picked)));
}

export function NameField({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (name: string) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <>
      <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('accounts.name')}</Text>
      <TextField value={value} onChangeText={onChangeText} placeholder={tr('accounts.name')} />
    </>
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

/** A titled card of fields; `tight` drops the gap between rows (a card of checkboxes). */
export function FormSection({
  title,
  first = false,
  tight = false,
  children,
}: {
  title: string;
  first?: boolean;
  tight?: boolean;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <>
      <SectionHeader first={first} title={title} />
      <Card style={{ marginHorizontal: t.space.lg, ...(tight ? {} : { gap: t.space.sm }) }}>
        {children}
      </Card>
    </>
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
