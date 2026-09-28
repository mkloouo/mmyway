// One asset account's page (design §6.6): everything FF3 lets you set on it, saved together and
// queued like any other write. Opened from Settings → Accounts (tap or long-press) and from a
// balance card on Activity (long-press).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, BackHandler, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { pickDate } from '../../src/ui/pickDate';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  AppBar,
  BarIconButton,
  SectionHeader,
  Card,
  Row,
  Button,
  Money,
  Toast,
} from '../../src/ui/components';
import { Checkbox } from '../../src/ui/Checkbox';
import { TextField } from '../../src/ui/TextField';
import { currencyOf } from '../../src/ui/money';
import { relativeTime } from '../../src/ui/relativeTime';
import { reportErrors } from '../../src/ui/reportError';
import { useToast } from '../../src/ui/useToast';
import { referenceAccounts, referenceCurrencies } from '../../src/db/schema';
import { hasEnvelopeMarker } from '../../src/accounts/envelopeMarker';
import {
  setAccountActive,
  setAccountEnvelope,
  updateAccount,
} from '../../src/accounts/accountActions';
import {
  ACCOUNT_ROLES,
  accountFormProblem,
  diffAccountEdit,
  formFromAccount,
  type AccountForm,
  type AccountRole,
} from '../../src/accounts/accountEdit';
import { parseSignedDecimalInput } from '../../src/api/ff3/decimal';
import { appLocale } from '../../src/i18n';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { pickableCurrencies } from '../../src/ui/currencies';
import { PendingDot } from '../../src/ui/PendingDot';
import { usePendingAccountIds } from '../../src/accounts/usePendingAccountIds';

const ROLE_LABEL_KEYS: Record<AccountRole, string> = {
  defaultAsset: 'account.roleDefault',
  sharedAsset: 'account.roleShared',
  savingAsset: 'account.roleSaving',
  ccAsset: 'account.roleCreditCard',
  cashWalletAsset: 'account.roleCashWallet',
};

/** A picked calendar day as YYYY-MM-DD, in local time (toISOString would shift it to UTC). */
function dayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayDate(day: string | null): Date {
  if (!day) return new Date();
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function dayLabel(day: string | null): string | null {
  return day
    ? dayDate(day).toLocaleDateString(appLocale(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;
}

export default function AccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const pendingAccounts = usePendingAccountIds();

  const { data: rows } = useLiveQuery(
    db.select().from(referenceAccounts).where(eq(referenceAccounts.id, id)),
    [id],
  );
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const account = rows?.[0];

  // The form starts from the row as it was when the page opened; a sync landing meanwhile doesn't
  // overwrite what is being typed.
  const [initial, setInitial] = useState<AccountForm | null>(null);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [active, setActive] = useState(true);
  const [envelope, setEnvelope] = useState(false);
  // Amount fields are kept as typed ("12,5", "-") and parsed on Save.
  const [openingText, setOpeningText] = useState('');
  const [virtualText, setVirtualText] = useState('');
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [roleSheetOpen, setRoleSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useToast();

  if (account && !initial) {
    const start = formFromAccount(account);
    setInitial(start);
    setForm(start);
    setActive(account.active);
    setEnvelope(hasEnvelopeMarker(account.notes));
    setOpeningText(start.openingBalance ?? '');
    setVirtualText(start.virtualBalance ?? '');
  }

  const opening = openingText.trim() ? parseSignedDecimalInput(openingText) : null;
  const virtual = virtualText.trim() ? parseSignedDecimalInput(virtualText) : null;
  const amountsValid = (!opening || opening.ok) && (!virtual || virtual.ok);
  const next: AccountForm | null = form && {
    ...form,
    openingBalance: opening?.ok ? opening.value : null,
    virtualBalance: virtual?.ok ? virtual.value : null,
  };
  const edit = initial && next ? diffAccountEdit(initial, next) : {};
  const problem = next ? accountFormProblem(next) : null;
  const dirty =
    !!account &&
    (Object.keys(edit).length > 0 ||
      active !== account.active ||
      envelope !== hasEnvelopeMarker(account.notes));
  const canSave = dirty && amountsValid && !problem && !saving;

  function patch(fields: Partial<AccountForm>) {
    setForm((cur) => (cur ? { ...cur, ...fields } : cur));
  }

  function close() {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert(tr('account.discardTitle'), undefined, [
      { text: tr('capture.keepEditing'), style: 'cancel' },
      { text: tr('inbox.discard'), style: 'destructive', onPress: () => router.back() },
    ]);
  }

  // Re-subscribed every render so the handler sees the current `dirty`.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dirty) return false;
      close();
      return true;
    });
    return () => sub.remove();
  });

  function pickDay(value: string | null, onPick: (day: string) => void) {
    pickDate(dayDate(value), (picked) => onPick(dayString(picked)));
  }

  async function save() {
    if (!canSave || !account) return;
    setSaving(true);
    try {
      await reportErrors(
        tr('common.save'),
        async () => {
          await updateAccount(db, account.id, edit);
          if (active !== account.active) await setAccountActive(db, account.id, active);
          if (envelope !== hasEnvelopeMarker(account.notes))
            await setAccountEnvelope(db, account.id, envelope);
          router.back();
        },
        setToast,
      );
    } finally {
      setSaving(false);
    }
  }

  if (!account || !form) {
    return (
      <Screen bottom>
        <AppBar
          title={tr('account.title')}
          left={
            <BarIconButton icon="close" label={tr('common.close')} onPress={() => router.back()} />
          }
        />
      </Screen>
    );
  }

  const currency = currencyOf(currencies ?? [], account.currencyCode);
  const problemText =
    problem === 'name'
      ? tr('account.problemName')
      : problem === 'openingBalanceDate'
        ? tr('account.problemOpeningDate')
        : problem === 'monthlyPaymentDate'
          ? tr('account.problemPaymentDate')
          : null;

  return (
    <Screen bottom avoidKeyboard>
      <View style={{ flex: 1 }}>
        <AppBar
          title={account.name}
          subtitle={tr('count.asOf', { time: relativeTime(account.currentBalanceDate) })}
          left={<BarIconButton icon="close" label={tr('common.close')} onPress={close} />}
          right={<PendingDot visible={pendingAccounts.has(account.id)} />}
        />
        <ScrollView
          contentContainerStyle={{ paddingBottom: t.space.xl }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ alignItems: 'center', paddingVertical: t.space.md }}>
            <Money amount={account.currentBalance ?? '0'} currency={currency} size="heading" />
          </View>

          <SectionHeader title={tr('account.sectionAccount')} />
          <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('accounts.name')}</Text>
            <TextField
              value={form.name}
              onChangeText={(name) => patch({ name })}
              placeholder={tr('accounts.name')}
            />
            <Row
              label={tr('fields.currency')}
              value={form.currencyCode}
              chevron
              onPress={() => setCurrencySheetOpen(true)}
            />
            <Row
              label={tr('account.role')}
              value={tr(ROLE_LABEL_KEYS[form.accountRole])}
              chevron
              onPress={() => setRoleSheetOpen(true)}
            />
            {form.accountRole === 'ccAsset' && (
              <Row
                label={tr('account.monthlyPaymentDate')}
                value={dayLabel(form.monthlyPaymentDate) ?? tr('account.pickDate')}
                tone={form.monthlyPaymentDate ? 'default' : 'warn'}
                chevron
                onPress={() =>
                  pickDay(form.monthlyPaymentDate, (day) => patch({ monthlyPaymentDate: day }))
                }
              />
            )}
            {form.accountRole === 'ccAsset' && (
              <Text style={[t.type.label, { color: t.color.textFaint }]}>
                {tr('account.monthlyPaymentDateHint')}
              </Text>
            )}
          </Card>

          <SectionHeader title={tr('account.sectionOptions')} />
          <Card style={{ marginHorizontal: t.space.lg }}>
            <Checkbox
              checked={active}
              onPress={() => setActive((v) => !v)}
              label={tr('accounts.active')}
              hint={tr('accounts.activeHint')}
            />
            <Checkbox
              checked={envelope}
              onPress={() => setEnvelope((v) => !v)}
              label={tr('accounts.cashEnvelope')}
              hint={tr('accounts.cashEnvelopeHint')}
            />
            <Checkbox
              checked={form.includeNetWorth}
              onPress={() => patch({ includeNetWorth: !form.includeNetWorth })}
              label={tr('account.includeNetWorth')}
              hint={tr('account.includeNetWorthHint')}
            />
          </Card>

          <SectionHeader title={tr('account.sectionBalances')} />
          <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {tr('account.openingBalance')}
            </Text>
            <TextField
              value={openingText}
              onChangeText={setOpeningText}
              keyboardType="numeric"
              placeholder="0"
            />
            {!!opening && !opening.ok && (
              <Text style={[t.type.label, { color: t.color.danger }]}>
                {tr('common.invalidAmount')}
              </Text>
            )}
            <Row
              label={tr('account.openingBalanceDate')}
              value={dayLabel(form.openingBalanceDate) ?? tr('account.pickDate')}
              chevron
              onPress={() =>
                pickDay(form.openingBalanceDate, (day) => patch({ openingBalanceDate: day }))
              }
            />
            <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.sm }]}>
              {tr('account.virtualBalance')}
            </Text>
            <TextField
              value={virtualText}
              onChangeText={setVirtualText}
              keyboardType="numeric"
              placeholder="0"
            />
            {!!virtual && !virtual.ok && (
              <Text style={[t.type.label, { color: t.color.danger }]}>
                {tr('common.invalidAmount')}
              </Text>
            )}
            <Text style={[t.type.label, { color: t.color.textFaint }]}>
              {tr('account.virtualBalanceHint')}
            </Text>
          </Card>
        </ScrollView>

        <View style={{ padding: t.space.lg, gap: t.space.sm }}>
          {!!problemText && (
            <Text style={[t.type.label, { color: t.color.warn, textAlign: 'center' }]}>
              {problemText}
            </Text>
          )}
          <Button
            title={saving ? tr('common.saving') : tr('common.save')}
            onPress={save}
            disabled={!canSave}
            size="lg"
          />
        </View>
        <Toast message={toast} />
      </View>

      <PickerSheet
        visible={currencySheetOpen}
        onClose={() => setCurrencySheetOpen(false)}
        title={tr('fields.currency')}
        options={pickableCurrencies(currencies, form.currencyCode).map((c) => ({
          key: c.code,
          label: c.code,
        }))}
        selected={form.currencyCode}
        onSelect={(code) => code && patch({ currencyCode: code })}
      />

      <PickerSheet
        visible={roleSheetOpen}
        onClose={() => setRoleSheetOpen(false)}
        title={tr('account.role')}
        options={ACCOUNT_ROLES.map((role) => ({ key: role, label: tr(ROLE_LABEL_KEYS[role]) }))}
        selected={form.accountRole}
        onSelect={(role) => role && patch({ accountRole: role as AccountRole })}
      />
    </Screen>
  );
}
