// New account (Settings → Accounts → +): an asset or a liability created on the device and queued like
// every other write. The form is the one the data layer takes (src/accounts/accountCreate.ts). Amounts
// are kept as typed and turned into canonical decimals here, so nothing reaches the outbox unparsed.
// Nothing is queued until the user confirms.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../src/providers/DbProvider';
import { useCurrencies } from '../../src/db/useReferenceData';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  AppBar,
  SectionHeader,
  Card,
  Chip,
  Row,
  Button,
  Toast,
  CloseButton,
  SCREEN_TOP_PADDING,
} from '../../src/ui/components';
import { Checkbox } from '../../src/ui/Checkbox';
import { TextField } from '../../src/ui/TextField';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { pickableCurrencies, primaryCurrencyCode } from '../../src/ui/currencies';
import { confirmAction } from '../../src/ui/confirm';
import { pickDate } from '../../src/ui/pickDate';
import { useAction } from '../../src/ui/useAction';
import { useConfirmDiscard } from '../../src/ui/useConfirmDiscard';
import { useToast } from '../../src/ui/useToast';
import { ACCOUNT_ROLES, type AccountRole } from '../../src/accounts/accountEdit';
import {
  accountCreateProblem,
  enqueueAccountCreate,
  type AccountCreateForm,
  type AccountCreateProblem,
} from '../../src/accounts/accountCreate';
import { parseDecimalInput, parseSignedDecimalInput } from '../../src/api/ff3/decimal';
import { appLocale } from '../../src/i18n';
import { dayDate, localDay } from '../../src/utils/day';

const ROLE_LABEL_KEYS: Record<AccountRole, string> = {
  defaultAsset: 'account.roleDefault',
  sharedAsset: 'account.roleShared',
  savingAsset: 'account.roleSaving',
  ccAsset: 'account.roleCreditCard',
  cashWalletAsset: 'account.roleCashWallet',
};

const LIABILITY_TYPE_KEYS = {
  loan: 'account.liabilityLoan',
  debt: 'account.liabilityDebt',
  mortgage: 'account.liabilityMortgage',
} as const;

const DIRECTION_KEYS = {
  debit: 'account.directionDebit',
  credit: 'account.directionCredit',
} as const;

const PERIOD_KEYS = {
  weekly: 'account.periodWeekly',
  monthly: 'account.periodMonthly',
  quarterly: 'account.periodQuarterly',
  'half-year': 'account.periodHalfYear',
  yearly: 'account.periodYearly',
} as const;

// A problem that is about an amount is shown under its field instead, so only these need text here.
const PROBLEM_KEYS: Partial<Record<AccountCreateProblem, string>> = {
  name: 'account.problemName',
  currencyCode: 'account.problemCurrency',
  openingBalanceDate: 'account.problemOpeningDate',
  monthlyPaymentDate: 'account.problemPaymentDate',
  liabilityType: 'account.problemLiabilityType',
  liabilityDirection: 'account.problemLiabilityDirection',
};

const EMPTY_FORM: AccountCreateForm = {
  name: '',
  type: 'asset',
  currencyCode: '',
  accountRole: 'defaultAsset',
  includeNetWorth: true,
  openingBalance: null,
  openingBalanceDate: null,
  notes: null,
  monthlyPaymentDate: null,
  liabilityType: null,
  liabilityDirection: null,
  interest: null,
  interestPeriod: null,
  virtualBalance: null,
};

function dayLabel(day: string | null): string | null {
  return day
    ? dayDate(day).toLocaleDateString(appLocale(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;
}

export default function NewAccountScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const currencies = useCurrencies();
  // Opened from Settings → Liabilities with type=liability, from Settings → Accounts with type=asset.
  const { type: initialType } = useLocalSearchParams<{ type?: string }>();

  const [form, setForm] = useState<AccountCreateForm>(() => ({
    ...EMPTY_FORM,
    type: initialType === 'liability' ? 'liability' : 'asset',
  }));
  // Amount fields are kept as typed ("12,5", "-") and parsed below.
  const [openingText, setOpeningText] = useState('');
  const [rateText, setRateText] = useState('');
  const [limitText, setLimitText] = useState('');
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [roleSheetOpen, setRoleSheetOpen] = useState(false);
  const [liabilityTypeSheetOpen, setLiabilityTypeSheetOpen] = useState(false);
  const [directionSheetOpen, setDirectionSheetOpen] = useState(false);
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const act = useAction();
  const saving = act.pending(tr('common.save'));
  const [toast, setToast] = useToast();

  const asset = form.type === 'asset';
  const includeNetWorth = form.includeNetWorth ?? true;
  // FF3's default currency until the user picks one; blank (and so unsaveable) until the list loads.
  const currencyCode = form.currencyCode || primaryCurrencyCode(currencies) || '';

  const opening = openingText.trim() ? parseSignedDecimalInput(openingText) : null;
  // The rate and the credit limit belong to liabilities only, so an unreadable one left over from
  // an asset doesn't block saving.
  const rate = !asset && rateText.trim() ? parseDecimalInput(rateText) : null;
  const limit = !asset && limitText.trim() ? parseDecimalInput(limitText) : null;
  const amountsValid = (!opening || opening.ok) && (!rate || rate.ok) && (!limit || limit.ok);
  // The form as the data layer takes it: canonical decimals, or null for an amount that is blank or unreadable.
  const draft: AccountCreateForm = {
    ...form,
    currencyCode,
    includeNetWorth,
    openingBalance: opening?.ok ? opening.value : null,
    interest: rate?.ok ? rate.value : null,
    virtualBalance: limit?.ok ? limit.value : null,
  };
  const problem = accountCreateProblem(draft);
  const dirty =
    form.name !== '' ||
    openingText !== '' ||
    rateText !== '' ||
    limitText !== '' ||
    (form.notes ?? '') !== '';
  const canSave = !problem && amountsValid && !saving;

  function patch(fields: Partial<AccountCreateForm>) {
    setForm((cur) => ({ ...cur, ...fields }));
  }

  const close = useConfirmDiscard(dirty, 'account.discardTitle');

  function pickDay(value: string | null, onPick: (day: string) => void) {
    pickDate(value ? dayDate(value) : new Date(), (picked) => onPick(localDay(picked)));
  }

  const save = act(
    tr('common.save'),
    async () => {
      if (!canSave) return;
      const confirmed = await confirmAction(
        tr('account.confirmCreateTitle'),
        tr('common.save'),
        tr('account.confirmCreateMessage'),
      );
      if (!confirmed) return;
      await enqueueAccountCreate(db, draft);
      router.back();
    },
    setToast,
  );

  const problemKey = problem ? PROBLEM_KEYS[problem] : undefined;
  const problemText = problemKey ? tr(problemKey) : null;

  return (
    <Screen bottom avoidKeyboard>
      <View style={{ flex: 1 }}>
        <AppBar title={tr('account.createTitle')} left={<CloseButton onPress={close} />} />
        <ScrollView
          contentContainerStyle={{ paddingBottom: t.space.xl, paddingTop: SCREEN_TOP_PADDING }}
          keyboardShouldPersistTaps="handled"
        >
          <SectionHeader first title={tr('account.sectionAccount')} />
          <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('accounts.name')}</Text>
            <TextField
              value={form.name}
              onChangeText={(name) => patch({ name })}
              placeholder={tr('accounts.name')}
            />
            <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('account.type')}</Text>
            <View style={{ flexDirection: 'row', gap: t.space.sm }}>
              <Chip
                label={tr('account.typeAsset')}
                selected={asset}
                onPress={() => patch({ type: 'asset' })}
              />
              <Chip
                label={tr('account.typeLiability')}
                selected={!asset}
                onPress={() => patch({ type: 'liability' })}
              />
            </View>
            <Row
              label={tr('fields.currency')}
              value={currencyCode}
              chevron
              onPress={() => setCurrencySheetOpen(true)}
            />
            {asset && (
              <Row
                label={tr('account.role')}
                value={tr(ROLE_LABEL_KEYS[form.accountRole ?? 'defaultAsset'])}
                chevron
                onPress={() => setRoleSheetOpen(true)}
              />
            )}
            {asset && form.accountRole === 'ccAsset' && (
              <Row
                label={tr('account.monthlyPaymentDate')}
                value={dayLabel(form.monthlyPaymentDate ?? null) ?? tr('account.pickDate')}
                tone={form.monthlyPaymentDate ? 'default' : 'warn'}
                chevron
                onPress={() =>
                  pickDay(form.monthlyPaymentDate ?? null, (day) =>
                    patch({ monthlyPaymentDate: day }),
                  )
                }
              />
            )}
            {asset && form.accountRole === 'ccAsset' && (
              <Text style={[t.type.label, { color: t.color.textFaint }]}>
                {tr('account.monthlyPaymentDateHint')}
              </Text>
            )}
            <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('fields.note')}</Text>
            <TextField
              value={form.notes ?? ''}
              onChangeText={(notes) => patch({ notes: notes || null })}
              multiline
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
              keyboardType="decimal-pad"
              placeholder="0"
            />
            {!!opening && !opening.ok && (
              <Text style={[t.type.label, { color: t.color.danger }]}>
                {tr('common.invalidAmount')}
              </Text>
            )}
            <Row
              label={tr('account.openingBalanceDate')}
              value={dayLabel(form.openingBalanceDate ?? null) ?? tr('account.pickDate')}
              chevron
              onPress={() =>
                pickDay(form.openingBalanceDate ?? null, (day) =>
                  patch({ openingBalanceDate: day }),
                )
              }
            />
          </Card>

          {!asset && (
            <>
              <SectionHeader title={tr('account.sectionLiability')} />
              <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
                <Row
                  label={tr('account.liabilityType')}
                  value={
                    form.liabilityType
                      ? tr(LIABILITY_TYPE_KEYS[form.liabilityType])
                      : tr('account.choose')
                  }
                  tone={form.liabilityType ? 'default' : 'warn'}
                  chevron
                  onPress={() => setLiabilityTypeSheetOpen(true)}
                />
                <Row
                  label={tr('account.liabilityDirection')}
                  value={
                    form.liabilityDirection
                      ? tr(DIRECTION_KEYS[form.liabilityDirection])
                      : tr('account.choose')
                  }
                  tone={form.liabilityDirection ? 'default' : 'warn'}
                  chevron
                  onPress={() => setDirectionSheetOpen(true)}
                />
                <Text style={[t.type.label, { color: t.color.textMuted }]}>
                  {tr('account.interestRate')}
                </Text>
                <TextField
                  value={rateText}
                  onChangeText={setRateText}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
                {!!rate && !rate.ok && (
                  <Text style={[t.type.label, { color: t.color.danger }]}>
                    {tr('common.invalidAmount')}
                  </Text>
                )}
                <Row
                  label={tr('account.interestPeriod')}
                  value={
                    form.interestPeriod
                      ? tr(PERIOD_KEYS[form.interestPeriod])
                      : tr('account.choose')
                  }
                  chevron
                  onPress={() => setPeriodSheetOpen(true)}
                />
                <Text style={[t.type.label, { color: t.color.textMuted }]}>
                  {tr('account.creditLimit')}
                </Text>
                <TextField
                  value={limitText}
                  onChangeText={setLimitText}
                  keyboardType="decimal-pad"
                  placeholder="0"
                />
                {!!limit && !limit.ok && (
                  <Text style={[t.type.label, { color: t.color.danger }]}>
                    {tr('common.invalidAmount')}
                  </Text>
                )}
              </Card>
            </>
          )}

          {asset && (
            <>
              <SectionHeader title={tr('account.sectionOptions')} />
              <Card style={{ marginHorizontal: t.space.lg }}>
                <Checkbox
                  checked={includeNetWorth}
                  onPress={() => patch({ includeNetWorth: !includeNetWorth })}
                  label={tr('account.includeNetWorth')}
                  hint={tr('account.includeNetWorthHint')}
                />
              </Card>
            </>
          )}
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
        options={pickableCurrencies(currencies, currencyCode).map((c) => ({
          key: c.code,
          label: c.code,
        }))}
        selected={currencyCode}
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

      <PickerSheet
        visible={liabilityTypeSheetOpen}
        onClose={() => setLiabilityTypeSheetOpen(false)}
        title={tr('account.liabilityType')}
        options={Object.entries(LIABILITY_TYPE_KEYS).map(([key, labelKey]) => ({
          key,
          label: tr(labelKey),
        }))}
        selected={form.liabilityType}
        onSelect={(key) => key && patch({ liabilityType: key as keyof typeof LIABILITY_TYPE_KEYS })}
      />

      <PickerSheet
        visible={directionSheetOpen}
        onClose={() => setDirectionSheetOpen(false)}
        title={tr('account.liabilityDirection')}
        options={Object.entries(DIRECTION_KEYS).map(([key, labelKey]) => ({
          key,
          label: tr(labelKey),
        }))}
        selected={form.liabilityDirection}
        onSelect={(key) => key && patch({ liabilityDirection: key as keyof typeof DIRECTION_KEYS })}
      />

      <PickerSheet
        visible={periodSheetOpen}
        onClose={() => setPeriodSheetOpen(false)}
        title={tr('account.interestPeriod')}
        options={Object.entries(PERIOD_KEYS).map(([key, labelKey]) => ({
          key,
          label: tr(labelKey),
        }))}
        selected={form.interestPeriod}
        onSelect={(key) => key && patch({ interestPeriod: key as keyof typeof PERIOD_KEYS })}
      />
    </Screen>
  );
}
