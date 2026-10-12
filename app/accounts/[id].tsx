// One account's page (design §6.6): everything FF3 lets you set on it, saved together and
// queued like any other write. A liability shows only the fields that apply to it. Opened from
// Settings → Accounts or Settings → Liabilities (tap or long-press) and from a
// balance card on Activity (long-press). The balance itself isn't here — it is on the card that
// opens this page, and repeating it above fields that edit the opening balance only confused the
// two.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useCurrencies } from '../../src/db/useReferenceData';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, Row, Toast, CloseButton } from '../../src/ui/components';
import { Checkbox } from '../../src/ui/Checkbox';
import { TextField } from '../../src/ui/TextField';
import { useAction } from '../../src/ui/useAction';
import { useConfirmDiscard } from '../../src/ui/useConfirmDiscard';
import { useToast } from '../../src/ui/useToast';
import { referenceAccounts } from '../../src/db/schema';
import { hasEnvelopeMarker, setEnvelopeMarker } from '../../src/accounts/envelopeMarker';
import {
  setAccountActive,
  setAccountEnvelope,
  updateAccount,
} from '../../src/accounts/accountActions';
import {
  accountFormProblem,
  diffAccountEdit,
  formFromAccount,
  type AccountEdit,
  type AccountForm,
} from '../../src/accounts/accountEdit';
import { parseSignedDecimalInput } from '../../src/api/ff3/decimal';
import { PendingDot } from '../../src/ui/PendingDot';
import { usePendingAccountIds } from '../../src/accounts/usePendingAccountIds';
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
  const currencies = useCurrencies();
  const account = rows?.[0];

  // The form starts from the row as it was when the page opened; a sync landing meanwhile doesn't
  // overwrite what is being typed.
  const [initial, setInitial] = useState<AccountForm | null>(null);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [active, setActive] = useState(true);
  const [envelope, setEnvelope] = useState(false);
  // The account's notes without the cash-envelope marker line, which has its own checkbox.
  const [description, setDescription] = useState('');
  const [initialDescription, setInitialDescription] = useState('');
  // Amount fields are kept as typed ("12,5", "-") and parsed on Save.
  const [openingText, setOpeningText] = useState('');
  const [virtualText, setVirtualText] = useState('');
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [roleSheetOpen, setRoleSheetOpen] = useState(false);
  const act = useAction();
  const saving = act.pending(tr('common.save'));
  const [toast, setToast] = useToast();

  if (account && !initial) {
    const start = formFromAccount(account);
    setInitial(start);
    setForm(start);
    setActive(account.active);
    setEnvelope(hasEnvelopeMarker(account.notes));
    const startDescription = setEnvelopeMarker(account.notes, false);
    setDescription(startDescription);
    setInitialDescription(startDescription);
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
  // A liability has no role, card, net-worth flag or cash envelope; those controls are left out.
  const liability = account?.type === 'liability';
  const descriptionChanged = description !== initialDescription;
  // A changed description sends the whole notes text, the envelope marker as it now is included;
  // the marker alone is a read-modify-write at replay (see setAccountEnvelope).
  const edit: AccountEdit = {
    ...(initial && next ? diffAccountEdit(initial, next, liability ? 'liability' : 'asset') : {}),
    ...(descriptionChanged ? { notes: setEnvelopeMarker(description, envelope) || null } : {}),
  };
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

  const close = useConfirmDiscard(dirty, 'account.discardTitle');

  const save = act(
    tr('common.save'),
    async () => {
      if (!canSave || !account) return;
      await updateAccount(db, account.id, edit);
      if (active !== account.active) await setAccountActive(db, account.id, active);
      if (!descriptionChanged && envelope !== hasEnvelopeMarker(account.notes))
        await setAccountEnvelope(db, account.id, envelope);
      router.back();
    },
    setToast,
  );

  if (!account || !form) {
    return (
      <Screen bottom>
        <AppBar title={tr('account.title')} left={<CloseButton onPress={() => router.back()} />} />
      </Screen>
    );
  }

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
          left={<CloseButton onPress={close} />}
          right={<PendingDot visible={pendingAccounts.has(account.id)} />}
        />
        <FormScroll>
          <FormSection first title={tr('account.sectionAccount')}>
            <NameField value={form.name} onChangeText={(name) => patch({ name })} />
            <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('fields.note')}</Text>
            <TextField value={description} onChangeText={setDescription} multiline />
            <Row
              label={tr('fields.currency')}
              value={form.currencyCode}
              chevron
              onPress={() => setCurrencySheetOpen(true)}
            />
            {!liability && (
              <Row
                label={tr('account.role')}
                value={tr(ROLE_LABEL_KEYS[form.accountRole])}
                chevron
                onPress={() => setRoleSheetOpen(true)}
              />
            )}
            {!liability && form.accountRole === 'ccAsset' && (
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
            {!liability && form.accountRole === 'ccAsset' && (
              <Text style={[t.type.label, { color: t.color.textFaint }]}>
                {tr('account.monthlyPaymentDateHint')}
              </Text>
            )}
          </FormSection>

          <FormSection tight title={tr('account.sectionOptions')}>
            <Checkbox
              checked={active}
              onPress={() => setActive((v) => !v)}
              label={tr('accounts.active')}
              hint={tr('accounts.activeHint')}
            />
            {!liability && (
              <Checkbox
                checked={envelope}
                onPress={() => setEnvelope((v) => !v)}
                label={tr('accounts.cashEnvelope')}
                hint={tr('accounts.cashEnvelopeHint')}
              />
            )}
            {!liability && (
              <Checkbox
                checked={form.includeNetWorth}
                onPress={() => patch({ includeNetWorth: !form.includeNetWorth })}
                label={tr('account.includeNetWorth')}
                hint={tr('account.includeNetWorthHint')}
              />
            )}
          </FormSection>

          <FormSection title={tr('account.sectionBalances')}>
            <AmountField
              label={tr('account.openingBalance')}
              text={openingText}
              onChangeText={setOpeningText}
              parsed={opening}
            />
            <Row
              label={tr('account.openingBalanceDate')}
              value={dayLabel(form.openingBalanceDate) ?? tr('account.pickDate')}
              chevron
              onPress={() =>
                pickDay(form.openingBalanceDate, (day) => patch({ openingBalanceDate: day }))
              }
            />
            <AmountField
              label={tr('account.virtualBalance')}
              text={virtualText}
              onChangeText={setVirtualText}
              parsed={virtual}
              spaced
            />
            <Text style={[t.type.label, { color: t.color.textFaint }]}>
              {tr('account.virtualBalanceHint')}
            </Text>
          </FormSection>
        </FormScroll>

        <SaveBar problemText={problemText} saving={saving} disabled={!canSave} onSave={save} />
        <Toast message={toast} />
      </View>

      <CurrencySheet
        visible={currencySheetOpen}
        onClose={() => setCurrencySheetOpen(false)}
        currencies={currencies}
        selected={form.currencyCode}
        onSelect={(code) => patch({ currencyCode: code })}
      />

      <RoleSheet
        visible={roleSheetOpen}
        onClose={() => setRoleSheetOpen(false)}
        selected={form.accountRole}
        onSelect={(role) => patch({ accountRole: role })}
      />
    </Screen>
  );
}
