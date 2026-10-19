// One account's page (design §6.6): everything FF3 lets you set on it, saved together and
// queued like any other write. A liability shows only the fields that apply to it. Opened from
// Settings → Accounts or Settings → Liabilities (tap or long-press) and from a
// balance card on Activity (long-press). The current balance is shown in the header's subtitle,
// not near the opening-balance fields: a balance above fields that edit the opening balance only
// confused the two.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useCurrencies } from '../../src/db/useReferenceData';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
// prettier-ignore
import { Button, Card, GroupFooter, ListRow, PushHeader, Screen, SectionHeader, Sheet, SwitchRow, Tile, Toast } from '../../src/ui/kit';
import { useAction } from '../../src/ui/useAction';
import { useConfirmDiscard } from '../../src/ui/useConfirmDiscard';
import { useToast } from '../../src/ui/useToast';
import { currencyOf, formatMoney } from '../../src/ui/money';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
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
import { accountKind } from '../../src/accounts/AccountList';
import {
  FormScroll,
  AmountField,
  CurrencySheet,
  InlineField,
  RoleSheet,
  ROLE_LABEL_KEYS,
  dayLabel,
  pickDay,
} from '../../src/accounts/AccountFormParts';
import { SaveBar } from '../../src/ui/SaveBar';

function TrailingMuted({ text, warn }: { text: string; warn?: boolean }) {
  const t = useTheme();
  return (
    <Text style={[t.type.body, { color: warn ? t.color.warn : t.color.textMuted }]}>{text}</Text>
  );
}

/** An amount as a row shows it: formatted once it parses, the typed text until then, '—' when empty. */
function amountText(
  text: string,
  parsed: ReturnType<typeof parseSignedDecimalInput> | null,
  currency: ReturnType<typeof currencyOf>,
): string {
  return !text.trim() ? '—' : parsed?.ok ? formatMoney(parsed.value, currency) : text.trim();
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
  const currencies = useCurrencies();
  const account = rows?.[0];

  // The form starts from the row as it was when the page opened; a sync landing meanwhile doesn't
  // overwrite what is being typed.
  const [initial, setInitial] = useState<AccountForm | null>(null);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [active, setActive] = useState(true);
  const [envelope, setEnvelope] = useState(false);
  // The account's notes without the cash-envelope marker line, which has its own switch.
  const [description, setDescription] = useState('');
  const [initialDescription, setInitialDescription] = useState('');
  // Amount fields are kept as typed ("12,5", "-") and parsed on Save.
  const [openingText, setOpeningText] = useState('');
  const [virtualText, setVirtualText] = useState('');
  // Which balance the Edit sheet is open on, or none.
  const [balanceSheet, setBalanceSheet] = useState<'opening' | 'virtual' | null>(null);
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

  // What the save bar says changed: one field by name, or how many.
  const changed: string[] = [];
  if (edit.name !== undefined) changed.push(tr('accounts.name'));
  if (edit.notes !== undefined) changed.push(tr('account.note'));
  if (edit.accountRole !== undefined) changed.push(tr('account.kind'));
  if (edit.currencyCode !== undefined) changed.push(tr('fields.currency'));
  if (edit.monthlyPaymentDate !== undefined && edit.accountRole === undefined)
    changed.push(tr('account.monthlyPaymentDate'));
  if (edit.openingBalance !== undefined || edit.openingBalanceDate !== undefined)
    changed.push(tr('account.openingBalance'));
  if (edit.virtualBalance !== undefined) changed.push(tr('account.virtualBalance'));
  if (edit.includeNetWorth !== undefined) changed.push(tr('account.fieldNetWorth'));
  if (account && active !== account.active) changed.push(tr('account.fieldActive'));
  if (account && envelope !== hasEnvelopeMarker(account.notes))
    changed.push(tr('account.fieldCashCount'));
  const summary =
    changed.length === 1
      ? tr('account.changedOne', { field: changed[0] })
      : tr('account.changeCount', { count: changed.length });

  function patch(fields: Partial<AccountForm>) {
    setForm((cur) => (cur ? { ...cur, ...fields } : cur));
  }

  const close = useConfirmDiscard(dirty, 'account.discardTitle');

  function undo() {
    if (!initial || !account) return;
    setForm(initial);
    setActive(account.active);
    setEnvelope(hasEnvelopeMarker(account.notes));
    setDescription(initialDescription);
    setOpeningText(initial.openingBalance ?? '');
    setVirtualText(initial.virtualBalance ?? '');
  }

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
        <PushHeader backLabel={tr('accounts.title')} onBack={() => router.back()} />
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

  const kind = accountKind(account);
  const currency = currencyOf(currencies, form.currencyCode);
  const openingDay = dayLabel(form.openingBalanceDate);
  // The balance is in the account's own currency, not the one the form may have changed to.
  const balanceNow =
    account.currentBalance == null
      ? null
      : formatMoney(account.currentBalance, currencyOf(currencies, account.currencyCode));

  return (
    <Screen bottom avoidKeyboard>
      <View style={{ flex: 1 }}>
        <PushHeader
          backLabel={liability ? tr('liabilities.title') : tr('accounts.title')}
          onBack={close}
          right={<PendingDot visible={pendingAccounts.has(account.id)} />}
          title={account.name}
          subtitle={
            balanceNow
              ? tr('account.subtitleNow', { balance: balanceNow, kind: tr(kind.labelKey) })
              : tr(kind.labelKey)
          }
          leading={<Tile icon={kind.icon} tone={kind.tone} size={52} />}
        />
        <FormScroll>
          <View
            style={{
              flexDirection: 'row',
              gap: t.space.sm,
              paddingHorizontal: t.space.lg,
              paddingBottom: t.space.sm,
            }}
          >
            {!liability && hasEnvelopeMarker(account.notes) && (
              <Button
                title={tr('count.title')}
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => router.push('/count')}
              />
            )}
            <Button
              title={tr('account.transactions')}
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() =>
                router.navigate({
                  pathname: '/activity',
                  params: { account: account.id, at: String(Date.now()) },
                })
              }
            />
          </View>

          <SectionHeader first title={tr('account.sectionDetails')} />
          <Card flush style={{ marginHorizontal: t.space.lg }}>
            <InlineField
              first
              label={tr('accounts.name')}
              value={form.name}
              placeholder={tr('accounts.name')}
              onChangeText={(name) => patch({ name })}
            />
            <InlineField
              label={tr('account.note')}
              value={description}
              placeholder={tr('account.optional')}
              onChangeText={setDescription}
              multiline
            />
            {!liability && (
              <ListRow
                label={tr('account.kind')}
                trailing={<TrailingMuted text={tr(ROLE_LABEL_KEYS[form.accountRole])} />}
                chevron
                onPress={() => setRoleSheetOpen(true)}
              />
            )}
            <ListRow
              label={tr('fields.currency')}
              trailing={<TrailingMuted text={form.currencyCode} />}
              chevron
              onPress={() => setCurrencySheetOpen(true)}
            />
            {!liability && form.accountRole === 'ccAsset' && (
              <ListRow
                label={tr('account.monthlyPaymentDate')}
                trailing={
                  <TrailingMuted
                    text={dayLabel(form.monthlyPaymentDate) ?? tr('account.pickDate')}
                    warn={!form.monthlyPaymentDate}
                  />
                }
                chevron
                onPress={() =>
                  pickDay(form.monthlyPaymentDate, (day) => patch({ monthlyPaymentDate: day }))
                }
              />
            )}
          </Card>
          {!liability && form.accountRole === 'ccAsset' && (
            <GroupFooter>{tr('account.monthlyPaymentDateHint')}</GroupFooter>
          )}

          <SectionHeader title={tr('account.sectionWhere')} />
          <Card flush style={{ marginHorizontal: t.space.lg }}>
            <SwitchRow
              first
              value={active}
              onValueChange={() => setActive((v) => !v)}
              label={tr('accounts.active')}
              hint={tr('accounts.activeHint')}
            />
            {!liability && (
              <SwitchRow
                value={envelope}
                onValueChange={() => setEnvelope((v) => !v)}
                label={tr('accounts.cashEnvelope')}
                hint={tr('accounts.cashEnvelopeHint')}
              />
            )}
            {!liability && (
              <SwitchRow
                value={form.includeNetWorth}
                onValueChange={() => patch({ includeNetWorth: !form.includeNetWorth })}
                label={tr('account.includeNetWorth')}
                hint={tr('account.includeNetWorthHint')}
              />
            )}
          </Card>

          <SectionHeader title={tr('account.sectionStart')} />
          <Card flush style={{ marginHorizontal: t.space.lg }}>
            <ListRow
              first
              label={tr('account.openingBalance')}
              sub={
                openingDay ? tr('account.balanceOn', { date: openingDay }) : tr('account.pickDate')
              }
              trailing={<TrailingMuted text={amountText(openingText, opening, currency)} />}
              chevron
              onPress={() => setBalanceSheet('opening')}
            />
            <ListRow
              label={tr('account.virtualBalance')}
              sub={tr('account.virtualBalanceSub')}
              trailing={<TrailingMuted text={amountText(virtualText, virtual, currency)} />}
              chevron
              onPress={() => setBalanceSheet('virtual')}
            />
          </Card>
        </FormScroll>

        {dirty && (
          <SaveBar
            problemText={problemText}
            saving={saving}
            disabled={!canSave}
            onSave={save}
            summary={summary}
            onUndo={undo}
          />
        )}
        <Toast message={toast} />
      </View>

      <Sheet
        visible={balanceSheet !== null}
        title={
          balanceSheet === 'virtual' ? tr('account.virtualBalance') : tr('account.openingBalance')
        }
        onClose={() => setBalanceSheet(null)}
        footer={
          <Button title={tr('common.done')} onPress={() => setBalanceSheet(null)} size="lg" />
        }
      >
        <Card style={{ gap: t.space.sm }}>
          {balanceSheet === 'virtual' ? (
            <>
              <AmountField
                label={tr('account.virtualBalance')}
                text={virtualText}
                onChangeText={setVirtualText}
                parsed={virtual}
              />
              <Text style={[t.type.label, { color: t.color.textFaint }]}>
                {tr('account.virtualBalanceHint')}
              </Text>
            </>
          ) : (
            <>
              <AmountField
                label={tr('account.openingBalance')}
                text={openingText}
                onChangeText={setOpeningText}
                parsed={opening}
              />
              <ListRow
                first={false}
                label={tr('account.openingBalanceDate')}
                trailing={<TrailingMuted text={openingDay ?? tr('account.pickDate')} />}
                chevron
                onPress={() =>
                  pickDay(form.openingBalanceDate, (day) => patch({ openingBalanceDate: day }))
                }
              />
            </>
          )}
        </Card>
      </Sheet>

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
