// New account (Settings → Accounts → +, Settings → Liabilities → +): an asset or a liability created on the
// device and queued like every other write. A two-step modal: step 1 says what kind it is and its details,
// step 2 holds the amounts (a liability: what is owed, the interest, the limit). The form is the one the
// data layer takes (src/accounts/accountCreate.ts). Amounts are kept as typed and turned into canonical
// decimals here, so nothing reaches the outbox unparsed. Nothing is queued until the user confirms.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../src/providers/DbProvider';
import { useCurrencies } from '../../src/db/useReferenceData';
import { useTheme } from '../../src/ui/theme';
import { Card, ListRow, ModalWizard, SectionHeader, SwitchRow, Toast } from '../../src/ui/kit';
import { TextField } from '../../src/ui/TextField';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { primaryCurrencyCode } from '../../src/ui/currencies';
import { confirmAction } from '../../src/ui/confirm';
import { useAction } from '../../src/ui/useAction';
import { withFlag } from '../../src/flags/RequireFlag';
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
  AmountField,
  CurrencySheet,
  InlineField,
  RoleSheet,
  ROLE_LABEL_KEYS,
  dayLabel,
  KindCard,
  pickDay,
} from '../../src/accounts/AccountFormParts';

function TrailingMuted({ text, warn }: { text: string; warn?: boolean }) {
  const t = useTheme();
  return (
    <Text style={[t.type.body, { color: warn ? t.color.warn : t.color.textMuted }]}>{text}</Text>
  );
}

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

// The problems step 1 owns; anything else is on step 2.
const STEP1_PROBLEMS = new Set<AccountCreateProblem>([
  'name',
  'currencyCode',
  'monthlyPaymentDate',
  'liabilityType',
]);

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

function NewAccountScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const currencies = useCurrencies();
  // Opened from Settings → Liabilities with type=liability, from Settings → Accounts with type=asset.
  const { type: initialType } = useLocalSearchParams<{ type?: string }>();

  const [step, setStep] = useState<1 | 2>(1);
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
  const step1Ok =
    !!form.name.trim() &&
    !!currencyCode &&
    (asset || !!form.liabilityType) &&
    (!asset || form.accountRole !== 'ccAsset' || !!form.monthlyPaymentDate);
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
  // On step 1 only a step-1 problem is shown; step 2 shows whatever still blocks the create.
  const problemText =
    problemKey && (step === 2 || (problem && STEP1_PROBLEMS.has(problem))) ? tr(problemKey) : null;

  const liabilityTypeLabel = form.liabilityType
    ? tr(LIABILITY_TYPE_KEYS[form.liabilityType])
    : null;
  const directionLabel = form.liabilityDirection
    ? tr(DIRECTION_KEYS[form.liabilityDirection])
    : null;

  return (
    <ModalWizard
      title={asset ? tr('account.createTitle') : tr('account.newLiabilityTitle')}
      step={step}
      total={2}
      onClose={close}
      problem={problemText}
      onBack={step > 1 ? () => setStep(1) : undefined}
      primary={
        step === 1
          ? {
              label: tr('account.continue'),
              disabled: !step1Ok,
              onPress: () => setStep(2),
              testID: 'new-account-continue',
            }
          : {
              label: asset ? tr('account.createAccount') : tr('account.createLiability'),
              disabled: !canSave,
              onPress: () => {
                void save();
              },
              testID: 'new-account-create',
            }
      }
      afterFooter={
        <>
          <Toast message={toast} />

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
            onSelect={(key) =>
              key && patch({ liabilityType: key as keyof typeof LIABILITY_TYPE_KEYS })
            }
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
            onSelect={(key) =>
              key && patch({ liabilityDirection: key as keyof typeof DIRECTION_KEYS })
            }
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
        </>
      }
    >
      {step === 1 ? (
        <>
          <SectionHeader first title={tr('account.sectionKind')} />
          <View style={{ flexDirection: 'row', gap: t.space.sm, marginHorizontal: t.space.lg }}>
            <KindCard
              testID="kind-asset"
              icon="card-outline"
              label={tr('account.kindAsset')}
              sub={tr('account.kindAssetHint')}
              selected={asset}
              onPress={() => patch({ type: 'asset' })}
            />
            <KindCard
              testID="kind-liability"
              icon="trending-down-outline"
              label={tr('account.kindLiability')}
              sub={tr('account.kindLiabilityHint')}
              selected={!asset}
              onPress={() => patch({ type: 'liability' })}
            />
          </View>

          <SectionHeader title={tr('account.sectionDetails')} />
          <Card flush style={{ marginHorizontal: t.space.lg }}>
            <InlineField
              first
              label={tr('accounts.name')}
              value={form.name}
              onChangeText={(name) => patch({ name })}
              placeholder={tr('accounts.name')}
            />
            {asset ? (
              <ListRow
                label={tr('account.type')}
                trailing={
                  <TrailingMuted text={tr(ROLE_LABEL_KEYS[form.accountRole ?? 'defaultAsset'])} />
                }
                chevron
                onPress={() => setRoleSheetOpen(true)}
              />
            ) : (
              <ListRow
                label={tr('account.liabilityType')}
                trailing={
                  <TrailingMuted
                    text={liabilityTypeLabel ?? tr('account.choose')}
                    warn={!liabilityTypeLabel}
                  />
                }
                chevron
                onPress={() => setLiabilityTypeSheetOpen(true)}
              />
            )}
            <ListRow
              label={tr('fields.currency')}
              trailing={<TrailingMuted text={currencyCode} />}
              chevron
              onPress={() => setCurrencySheetOpen(true)}
            />
            {asset && form.accountRole === 'ccAsset' && (
              <ListRow
                label={tr('account.paidOffOn')}
                sub={tr('account.paidOffOnHint')}
                trailing={
                  <TrailingMuted
                    text={dayLabel(form.monthlyPaymentDate ?? null) ?? tr('account.pickDate')}
                    warn={!form.monthlyPaymentDate}
                  />
                }
                chevron
                onPress={() =>
                  pickDay(form.monthlyPaymentDate ?? null, (day) =>
                    patch({ monthlyPaymentDate: day }),
                  )
                }
              />
            )}
          </Card>
          {asset && form.accountRole === 'ccAsset' && (
            <Text
              style={[
                t.type.label,
                { color: t.color.textFaint, marginHorizontal: t.space.lg, marginTop: t.space.xs },
              ]}
            >
              {tr('account.monthlyPaymentDateHint')}
            </Text>
          )}

          <View style={{ height: t.space.md }} />
          <Card flush style={{ marginHorizontal: t.space.lg }}>
            {asset && (
              <SwitchRow
                first
                value={includeNetWorth}
                onValueChange={() => patch({ includeNetWorth: !includeNetWorth })}
                label={tr('account.inNetWorth')}
                hint={tr('account.inNetWorthHint')}
              />
            )}
            <View
              style={{
                gap: t.space.xs,
                paddingHorizontal: t.space.lg,
                paddingVertical: t.space.sm,
                position: 'relative',
              }}
            >
              {asset && (
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 16,
                    right: 0,
                    height: 1,
                    backgroundColor: t.color.border,
                  }}
                />
              )}
              <Text style={[t.type.body, { color: t.color.text }]}>{tr('fields.note')}</Text>
              <TextField
                value={form.notes ?? ''}
                onChangeText={(notes) => patch({ notes: notes || null })}
                multiline
              />
            </View>
          </Card>
        </>
      ) : (
        <>
          {!asset && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: t.space.sm,
                marginHorizontal: t.space.lg,
                marginTop: t.space.sm,
              }}
            >
              <Text style={[t.type.label, { color: t.color.textMuted, flex: 1 }]} numberOfLines={2}>
                {tr('account.summary', {
                  name: form.name.trim(),
                  type: liabilityTypeLabel ?? tr('account.choose'),
                  direction: directionLabel ?? tr('account.choose'),
                  currency: currencyCode,
                })}
              </Text>
              <Pressable
                testID="new-account-change"
                onPress={() => setStep(1)}
                accessibilityRole="button"
                accessibilityLabel={tr('account.change')}
                hitSlop={8}
              >
                <Text style={[t.type.label, { color: t.color.accent, fontWeight: '600' }]}>
                  {tr('account.change')}
                </Text>
              </Pressable>
            </View>
          )}

          <SectionHeader
            first={asset}
            title={asset ? tr('account.sectionBalances') : tr('account.sectionOwe')}
          />
          <Card style={{ marginHorizontal: t.space.lg }}>
            {!asset && (
              <ListRow
                first
                label={tr('account.liabilityDirection')}
                trailing={
                  <TrailingMuted
                    text={directionLabel ?? tr('account.choose')}
                    warn={!directionLabel}
                  />
                }
                chevron
                onPress={() => setDirectionSheetOpen(true)}
              />
            )}
            <AmountField
              label={tr('fields.amount')}
              text={openingText}
              onChangeText={setOpeningText}
              parsed={opening}
              keyboardType="decimal-pad"
              spaced={!asset}
            />
            <ListRow
              label={tr('account.asOf')}
              trailing={
                <TrailingMuted
                  text={dayLabel(form.openingBalanceDate ?? null) ?? tr('account.pickDate')}
                />
              }
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
              <SectionHeader title={tr('account.sectionInterest')} />
              <Card style={{ marginHorizontal: t.space.lg }}>
                <AmountField
                  label={tr('account.interestRate')}
                  text={rateText}
                  onChangeText={setRateText}
                  parsed={rate}
                  keyboardType="decimal-pad"
                />
                <ListRow
                  label={tr('account.interestPeriod')}
                  trailing={
                    <TrailingMuted
                      text={
                        form.interestPeriod
                          ? tr(PERIOD_KEYS[form.interestPeriod])
                          : tr('account.choose')
                      }
                    />
                  }
                  chevron
                  onPress={() => setPeriodSheetOpen(true)}
                />
              </Card>

              <SectionHeader title={tr('account.sectionLimit')} />
              <Card style={{ marginHorizontal: t.space.lg }}>
                <AmountField
                  label={tr('account.creditLimit')}
                  text={limitText}
                  onChangeText={setLimitText}
                  parsed={limit}
                  keyboardType="decimal-pad"
                />
              </Card>
            </>
          )}

          <Text
            style={[
              t.type.label,
              { color: t.color.textMuted, marginHorizontal: t.space.lg, marginTop: t.space.sm },
            ]}
          >
            {tr('account.footnote')}
          </Text>
        </>
      )}
    </ModalWizard>
  );
}

export default withFlag('account_create', NewAccountScreen);
