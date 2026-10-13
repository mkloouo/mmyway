// What the account page (app/accounts/[id].tsx) and New account (app/accounts/new.tsx) share: the
// amount field, the scroll, the currency and role sheets, and how a day is labelled and picked.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View, type KeyboardTypeOptions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { appLocale } from '../i18n';
import { PRESSED_OPACITY, ROW_HEIGHT, SCREEN_TOP_PADDING } from '../ui/kit';
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
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        minHeight: ROW_HEIGHT,
        paddingVertical: t.space.sm,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.color.border,
      }}
    >
      <Text style={[t.type.body, { color: t.color.text, width: 88 }]}>{label}</Text>
      <TextField
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline={multiline}
        style={{
          flex: 1,
          borderWidth: 0,
          paddingHorizontal: 0,
          paddingVertical: 0,
          textAlign: 'right',
          backgroundColor: 'transparent',
        }}
      />
    </View>
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
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => ({
        flex: 1,
        gap: t.space.sm,
        padding: selected ? t.space.md - 1 : t.space.md,
        borderRadius: t.radius.md,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? t.color.accent : t.color.border,
        backgroundColor: selected ? t.color.accentSoft : t.color.surface,
        opacity: pressed ? PRESSED_OPACITY : 1,
      })}
    >
      <Ionicons name={icon} size={22} color={selected ? t.color.accent : t.color.textMuted} />
      <Text style={[t.type.body, { color: t.color.text, fontWeight: '600' }]}>{label}</Text>
      <Text style={[t.type.label, { color: selected ? t.color.accent : t.color.textMuted }]}>
        {sub}
      </Text>
    </Pressable>
  );
}
