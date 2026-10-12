// New account (Settings → Accounts → +): an asset or a liability created on the device and queued like
// every other write. The form is the one the data layer takes (src/accounts/accountCreate.ts). Amounts
// are kept as typed and turned into canonical decimals here, so nothing reaches the outbox unparsed.
// Nothing is queued until the user confirms.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../src/providers/DbProvider';
import { useCurrencies } from '../../src/db/useReferenceData';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, Chip, Row, Toast, CloseButton } from '../../src/ui/components';
import { Checkbox } from '../../src/ui/Checkbox';
import { TextField } from '../../src/ui/TextField';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { primaryCurrencyCode } from '../../src/ui/currencies';
import { confirmAction } from '../../src/ui/confirm';
import { useAction } from '../../src/ui/useAction';
import { useConfirmDiscard } from '../../src/ui/useConfirmDiscard';
import { useToast } from '../../src/ui/useToast';
import {
  accountCreateProblem,
  type AccountCreateForm,
  type AccountCreateProblem,
} from '../../src/accounts/accountCreate';
import { enqueueAccountCreate } from '../../src/accounts/accountActions';
import { parseDecimalInput, parseSignedDecimalInput } from '../../src/api/ff3/decimal';
import {
  FormScroll,
  FormSection,
  AmountField,
  CurrencySheet,
  NameField,
  RoleSheet,
  ROLE_LABEL_KEYS,
  dayLabel,
  pickDay,
} from '../../src/accounts/AccountFormParts';
import { SaveBar } from '../../src/ui/SaveBar';

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
        <FormScroll>
          <FormSection first title={tr('account.sectionAccount')}>
            <NameField value={form.name} onChangeText={(name) => patch({ name })} />
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
          </FormSection>

          <FormSection title={tr('account.sectionBalances')}>
            <AmountField
              label={tr('account.openingBalance')}
              text={openingText}
              onChangeText={setOpeningText}
              parsed={opening}
              keyboardType="decimal-pad"
            />
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
          </FormSection>

          {!asset && (
            <>
              <FormSection title={tr('account.sectionLiability')}>
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
                <AmountField
                  label={tr('account.interestRate')}
                  text={rateText}
                  onChangeText={setRateText}
                  parsed={rate}
                  keyboardType="decimal-pad"
                />
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
                <AmountField
                  label={tr('account.creditLimit')}
                  text={limitText}
                  onChangeText={setLimitText}
                  parsed={limit}
                  keyboardType="decimal-pad"
                />
              </FormSection>
            </>
          )}

          {asset && (
            <>
              <FormSection tight title={tr('account.sectionOptions')}>
                <Checkbox
                  checked={includeNetWorth}
                  onPress={() => patch({ includeNetWorth: !includeNetWorth })}
                  label={tr('account.includeNetWorth')}
                  hint={tr('account.includeNetWorthHint')}
                />
              </FormSection>
            </>
          )}
        </FormScroll>

        <SaveBar problemText={problemText} saving={saving} disabled={!canSave} onSave={save} />
        <Toast message={toast} />
      </View>

      <CurrencySheet
        visible={currencySheetOpen}
        onClose={() => setCurrencySheetOpen(false)}
        currencies={currencies}
        selected={currencyCode}
        onSelect={(code) => patch({ currencyCode: code })}
      />

      <RoleSheet
        visible={roleSheetOpen}
        onClose={() => setRoleSheetOpen(false)}
        selected={form.accountRole}
        onSelect={(role) => patch({ accountRole: role })}
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
