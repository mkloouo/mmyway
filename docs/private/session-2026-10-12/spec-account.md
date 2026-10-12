# Account CRUD Implementation Spec

**Scope:** Account creation screen and API integration for Asset and Liability accounts. Support liability fields: interest rate, payment frequency, credit limit. Archive via `active:false`.

**Target Branch:** worktree-session-dialog-gaps  
**Base for PRs:** main  
**Database:** No schema changes (FF3 fields live in the POST body only).

---

## Key Design Decisions

1. **Account creation bypasses Inbox.** Unlike transactions, account creates go straight to outbox (no draft/confirm pattern). The user taps "New Account," fills the form, taps Save. No separate "confirm" sheet.

2. **Temporary local ID until server responds.** New accounts are created with a local UUID before FF3 responds. On successful POST, `recordCreated()` updates the local row with the server's actual ID (following transaction create pattern in outbox.ts).

3. **Liability fields optional in form.** Display them only when account type is Liability. Interest rate, credit limit, and frequency stay in the form; they're optional and sent as-is to FF3.

4. **Cash wallet enrollment.** A "Cash envelope" checkbox in the form (following the existing pattern) sets the `mmyway-envelope` marker. For account creates, it's applied during replay if the user checked it, not stored to FF3.

5. **Four registration sites for `create_account` kind:**
   - `src/db/schema.ts`: enum value in outboxOperations.kind
   - `src/sync/outbox.ts`: OutboxKind type
   - `src/sync/payloadJson.ts`: SCHEMAS map + zod schema
   - `src/sync/outboxSubjects.ts`: subjectsOf() case (subjects: account:{localId})

6. **No migration needed.** reference_accounts schema unchanged; new fields (interest_rate, liability_start_date, etc.) are FF3 request body only.

---

## File Structure & Signatures

### Chunk 1: Form & Diff Logic (`src/accounts/accountCreate.ts`)

**Purpose:** Extend account editing to support liability fields and creation payloads.

**New file:** `src/accounts/accountCreate.ts`

```typescript
import type { ReferenceAccountRow } from './useAssetAccounts';

// Account types FF3 accepts for POST /v1/accounts
export const FF3_ACCOUNT_TYPES = [
  'asset',
  'liability',
  'cash',
  'revenue',
  'expense',
] as const;
export type FF3AccountType = (typeof FF3_ACCOUNT_TYPES)[number];

// Liability-specific fields (optional, sent to FF3 only if provided)
export interface LiabilityFields {
  interestRate?: string | null;     // decimal, e.g. '3.50'
  creditLimit?: string | null;      // decimal
  liabilityStartDate?: string | null; // YYYY-MM-DD
  accountRole?: string | null;      // 'loan', 'debt', 'mortgage', etc. (if applicable)
  liabilityType?: string | null;    // FF3's liability_type field
  liabilityDirection?: 'debit' | 'credit' | null; // asset growth direction
  paymentFrequency?: string | null; // e.g. 'monthly', 'yearly'
}

// Form for creating a new account (subset of AccountForm + liability fields)
export interface NewAccountForm {
  name: string;
  type: FF3AccountType;
  accountRole?: string; // For assets: defaultAsset, ccAsset, etc.
  currencyCode: string;
  includeNetWorth: boolean;
  openingBalance?: string | null;
  openingBalanceDate?: string | null;
  notes?: string | null;
  // Liability fields
  interestRate?: string | null;
  creditLimit?: string | null;
  liabilityStartDate?: string | null;
  liabilityType?: string | null;
  liabilityDirection?: 'debit' | 'credit' | null;
  paymentFrequency?: string | null;
  // For ccAsset only
  creditCardType?: string | null;
  monthlyPaymentDate?: string | null;
}

// Empty form state for new-account screen
export function emptyNewAccountForm(currencyCode: string): NewAccountForm {
  return {
    name: '',
    type: 'asset',
    accountRole: 'defaultAsset',
    currencyCode,
    includeNetWorth: true,
    openingBalance: null,
    openingBalanceDate: null,
    notes: null,
    interestRate: null,
    creditLimit: null,
    liabilityStartDate: null,
    liabilityType: null,
    liabilityDirection: null,
    paymentFrequency: null,
    creditCardType: null,
    monthlyPaymentDate: null,
  };
}

// Validation before Save
export function newAccountFormProblem(
  form: NewAccountForm,
): 'name' | 'currencyCode' | 'openingBalanceDate' | 'monthlyPaymentDate' | null {
  if (!form.name.trim()) return 'name';
  if (!form.currencyCode.trim()) return 'currencyCode';
  if (form.openingBalance && !form.openingBalanceDate) return 'openingBalanceDate';
  if (form.type === 'asset' && form.accountRole === 'ccAsset' && !form.monthlyPaymentDate)
    return 'monthlyPaymentDate';
  return null;
}

// FF3 POST body for account creation
export function ff3CreateAccountBody(form: NewAccountForm): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    account_type: form.type,
    currency_code: form.currencyCode,
  };

  if (form.type === 'asset') {
    body.account_role = form.accountRole ?? 'defaultAsset';
    body.include_net_worth = form.includeNetWorth;
    if (form.openingBalance) {
      body.opening_balance = form.openingBalance;
      body.opening_balance_date = form.openingBalanceDate;
    }
    if (form.accountRole === 'ccAsset') {
      body.credit_card_type = 'monthlyFull';
      body.monthly_payment_date = form.monthlyPaymentDate;
    }
  }

  if (form.type === 'liability') {
    if (form.liabilityType) body.liability_type = form.liabilityType;
    if (form.liabilityDirection) body.liability_direction = form.liabilityDirection;
    if (form.interestRate) body.interest = form.interestRate; // FF3 names it 'interest'
    if (form.creditLimit) body.credit_limit = form.creditLimit;
    if (form.liabilityStartDate) body.liability_start_date = form.liabilityStartDate;
    if (form.paymentFrequency) body.payment_frequency = form.paymentFrequency;
  }

  if (form.notes) body.notes = form.notes;

  return body;
}
```

**Update file:** `src/accounts/accountEdit.ts`
- Export `CREDIT_CARD_TYPE` constant (already there, just make sure it's imported in accountCreate.ts).
- No other changes needed; keep asset-only logic separate.

---

### Chunk 2: Screen & Submission (`app/accounts/new.tsx`)

**Purpose:** Form screen for creating a new account.

**New file:** `app/accounts/new.tsx`

```typescript
// New account creation screen. Opened from Settings → Accounts → "+" button (or nav).
// Form: type selector, name, currency, role (asset-specific), liability fields, and save.
// On save: enqueue create_account outbox operation with temporary local ID,
// update reference_accounts with server's ID on sync.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useDb } from '../../src/providers/DbProvider';
import { useCurrencies } from '../../src/db/useReferenceData';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  AppBar,
  SectionHeader,
  Card,
  Row,
  Button,
  Toast,
  CloseButton,
  SCREEN_TOP_PADDING,
} from '../../src/ui/components';
import { TextField } from '../../src/ui/TextField';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { useAction } from '../../src/ui/useAction';
import { useConfirmDiscard } from '../../src/ui/useConfirmDiscard';
import { useToast } from '../../src/ui/useToast';
import { pickDate } from '../../src/ui/pickDate';
import { dayDate, localDay } from '../../src/utils/day';
import { appLocale } from '../../src/i18n';
import { parseSignedDecimalInput } from '../../src/api/ff3/decimal';
import {
  FF3_ACCOUNT_TYPES,
  LiabilityFields,
  NewAccountForm,
  emptyNewAccountForm,
  newAccountFormProblem,
} from '../../src/accounts/accountCreate';
import { createAccount } from '../../src/accounts/accountActions';
import { Checkbox } from '../../src/ui/Checkbox';

const LIABILITY_TYPES = ['loan', 'debt', 'mortgage', 'credit'];
const PAYMENT_FREQUENCIES = ['weekly', 'bi-weekly', 'monthly', 'bi-monthly', 'quarterly', 'yearly'];
const LIABILITY_DIRECTIONS = ['debit', 'credit'];

export default function NewAccountScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const currencies = useCurrencies() ?? [];
  const defaultCurrency = currencies.find((c) => c.isDefault)?.code ?? 'USD';

  const [form, setForm] = useState<NewAccountForm>(emptyNewAccountForm(defaultCurrency));
  const [openingText, setOpeningText] = useState('');
  const [envelope, setEnvelope] = useState(false);
  const [typeSheetOpen, setTypeSheetOpen] = useState(false);
  const [roleSheetOpen, setRoleSheetOpen] = useState(false);
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [liabilityTypeSheetOpen, setLiabilityTypeSheetOpen] = useState(false);
  const [frequencySheetOpen, setFrequencySheetOpen] = useState(false);
  const [directionSheetOpen, setDirectionSheetOpen] = useState(false);
  const [toast, setToast] = useToast();
  const act = useAction();
  const saving = act.pending(tr('common.save'));

  const opening = openingText.trim() ? parseSignedDecimalInput(openingText) : null;
  const amountsValid = !opening || opening.ok;
  const problem = newAccountFormProblem({ ...form, openingBalance: opening?.ok ? opening.value : null });
  const dirty = form.name.trim().length > 0;
  const canSave = dirty && amountsValid && !problem && !saving;

  function patch(fields: Partial<NewAccountForm>) {
    setForm((cur) => ({ ...cur, ...fields }));
  }

  const close = useConfirmDiscard(dirty, 'account.discardTitle');

  function pickDay(value: string | null, onPick: (day: string) => void) {
    pickDate(value ? dayDate(value) : new Date(), (picked) => onPick(localDay(picked)));
  }

  function dayLabel(day: string | null): string | null {
    return day ? dayDate(day).toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  }

  const save = act(
    tr('common.save'),
    async () => {
      if (!canSave) return;
      const finalForm: NewAccountForm = {
        ...form,
        openingBalance: opening?.ok ? opening.value : null,
      };
      await createAccount(db, finalForm, envelope);
      router.back();
    },
    setToast,
  );

  const problemText =
    problem === 'name'
      ? tr('account.problemName')
      : problem === 'currencyCode'
        ? tr('account.problemCurrency')
        : problem === 'openingBalanceDate'
          ? tr('account.problemOpeningDate')
          : problem === 'monthlyPaymentDate'
            ? tr('account.problemPaymentDate')
            : null;

  return (
    <Screen bottom avoidKeyboard>
      <View style={{ flex: 1 }}>
        <AppBar
          title={tr('account.createTitle')}
          left={<CloseButton onPress={close} />}
          right={<Button onPress={save} disabled={!canSave} label={saving ? '…' : tr('common.save')} />}
        />
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

            <Row
              label={tr('account.type')}
              value={tr(`account.type.${form.type}`)}
              chevron
              onPress={() => setTypeSheetOpen(true)}
            />

            <Row
              label={tr('fields.currency')}
              value={form.currencyCode}
              chevron
              onPress={() => setCurrencySheetOpen(true)}
            />

            {form.type === 'asset' && (
              <Row
                label={tr('account.role')}
                value={tr(`account.role.${form.accountRole}`)}
                chevron
                onPress={() => setRoleSheetOpen(true)}
              />
            )}

            {form.type === 'asset' && form.accountRole === 'ccAsset' && (
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

            <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('fields.note')}</Text>
            <TextField
              value={form.notes ?? ''}
              onChangeText={(notes) => patch({ notes: notes || null })}
              multiline
            />
          </Card>

          {form.type === 'asset' && (
            <>
              <SectionHeader title={tr('account.sectionOpeningBalance')} />
              <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
                <Text style={[t.type.label, { color: t.color.textMuted }]}>
                  {tr('account.openingBalance')}
                </Text>
                <TextField
                  value={openingText}
                  onChangeText={setOpeningText}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                />
                <Row
                  label={tr('account.openingBalanceDate')}
                  value={dayLabel(form.openingBalanceDate) ?? tr('account.pickDate')}
                  tone={form.openingBalanceDate ? 'default' : 'warn'}
                  chevron
                  onPress={() =>
                    pickDay(form.openingBalanceDate, (day) => patch({ openingBalanceDate: day }))
                  }
                />
                <Checkbox
                  checked={form.includeNetWorth}
                  onPress={() => patch({ includeNetWorth: !form.includeNetWorth })}
                  label={tr('account.includeNetWorth')}
                  hint={tr('account.includeNetWorthHint')}
                />
              </Card>
            </>
          )}

          {form.type === 'liability' && (
            <>
              <SectionHeader title={tr('account.sectionLiability')} />
              <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
                <Row
                  label={tr('account.liabilityType')}
                  value={form.liabilityType ? tr(`account.liabilityType.${form.liabilityType}`) : tr('account.selectType')}
                  chevron
                  onPress={() => setLiabilityTypeSheetOpen(true)}
                />
                <Row
                  label={tr('account.liabilityDirection')}
                  value={form.liabilityDirection ? tr(`account.direction.${form.liabilityDirection}`) : tr('account.selectDirection')}
                  chevron
                  onPress={() => setDirectionSheetOpen(true)}
                />
                <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('account.interestRate')}</Text>
                <TextField
                  value={form.interestRate ?? ''}
                  onChangeText={(rate) => patch({ interestRate: rate || null })}
                  placeholder="e.g. 3.50"
                  keyboardType="decimal-pad"
                />
                <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('account.creditLimit')}</Text>
                <TextField
                  value={form.creditLimit ?? ''}
                  onChangeText={(limit) => patch({ creditLimit: limit || null })}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                />
                <Row
                  label={tr('account.liabilityStartDate')}
                  value={dayLabel(form.liabilityStartDate) ?? tr('account.pickDate')}
                  chevron
                  onPress={() =>
                    pickDay(form.liabilityStartDate, (day) => patch({ liabilityStartDate: day }))
                  }
                />
                <Row
                  label={tr('account.paymentFrequency')}
                  value={form.paymentFrequency ? tr(`account.frequency.${form.paymentFrequency}`) : tr('account.selectFrequency')}
                  chevron
                  onPress={() => setFrequencySheetOpen(true)}
                />
              </Card>
            </>
          )}

          <SectionHeader title={tr('account.sectionOptions')} />
          <Card style={{ marginHorizontal: t.space.lg }}>
            <Checkbox
              checked={envelope}
              onPress={() => setEnvelope((v) => !v)}
              label={tr('accounts.cashEnvelope')}
              hint={tr('accounts.cashEnvelopeHint')}
            />
          </Card>

          {problemText && (
            <Card style={{ marginHorizontal: t.space.lg, marginTop: t.space.lg }}>
              <Text style={[t.type.label, { color: t.color.textWarn }]}>{problemText}</Text>
            </Card>
          )}
        </ScrollView>
      </View>

      <PickerSheet
        open={typeSheetOpen}
        onClose={() => setTypeSheetOpen(false)}
        title={tr('account.type')}
        items={FF3_ACCOUNT_TYPES.map((type) => ({
          value: type,
          label: tr(`account.type.${type}`),
        }))}
        value={form.type}
        onSelect={(type) => {
          patch({ type: type as any });
          setTypeSheetOpen(false);
        }}
      />
      <PickerSheet
        open={currencySheetOpen}
        onClose={() => setCurrencySheetOpen(false)}
        title={tr('fields.currency')}
        items={currencies.map((c) => ({ value: c.code, label: c.code }))}
        value={form.currencyCode}
        onSelect={(code) => {
          patch({ currencyCode: code });
          setCurrencySheetOpen(false);
        }}
      />
      <PickerSheet
        open={roleSheetOpen}
        onClose={() => setRoleSheetOpen(false)}
        title={tr('account.role')}
        items={[
          'defaultAsset',
          'sharedAsset',
          'savingAsset',
          'ccAsset',
          'cashWalletAsset',
        ].map((role) => ({ value: role, label: tr(`account.role.${role}`) }))}
        value={form.accountRole ?? 'defaultAsset'}
        onSelect={(role) => {
          patch({ accountRole: role });
          setRoleSheetOpen(false);
        }}
      />
      <PickerSheet
        open={liabilityTypeSheetOpen}
        onClose={() => setLiabilityTypeSheetOpen(false)}
        title={tr('account.liabilityType')}
        items={LIABILITY_TYPES.map((type) => ({
          value: type,
          label: tr(`account.liabilityType.${type}`),
        }))}
        value={form.liabilityType ?? ''}
        onSelect={(type) => {
          patch({ liabilityType: type || null });
          setLiabilityTypeSheetOpen(false);
        }}
      />
      <PickerSheet
        open={frequencySheetOpen}
        onClose={() => setFrequencySheetOpen(false)}
        title={tr('account.paymentFrequency')}
        items={PAYMENT_FREQUENCIES.map((freq) => ({
          value: freq,
          label: tr(`account.frequency.${freq}`),
        }))}
        value={form.paymentFrequency ?? ''}
        onSelect={(freq) => {
          patch({ paymentFrequency: freq || null });
          setFrequencySheetOpen(false);
        }}
      />
      <PickerSheet
        open={directionSheetOpen}
        onClose={() => setDirectionSheetOpen(false)}
        title={tr('account.liabilityDirection')}
        items={['debit', 'credit'].map((dir) => ({
          value: dir,
          label: tr(`account.direction.${dir}`),
        }))}
        value={form.liabilityDirection ?? ''}
        onSelect={(dir) => {
          patch({ liabilityDirection: (dir || null) as any });
          setDirectionSheetOpen(false);
        }}
      />
    </Screen>
  );
}
```

---

### Chunk 3: Actions & Outbox (`src/accounts/accountActions.ts` + payload registration)

**Update file:** `src/accounts/accountActions.ts`

Add new function:

```typescript
import type { NewAccountForm } from './accountCreate';

/**
 * Create a new account. Inserts a local row with a temporary UUID, enqueues the create_account
 * operation, and when the sync succeeds, recordCreated() updates the row with the server's ID.
 * Called from the new-account screen's Save button.
 */
export async function createAccount(
  db: OutboxDb,
  form: NewAccountForm,
  addEnvelope: boolean,
): Promise<string> {
  const tempId = generateId();
  const now = new Date().toISOString();

  // Insert local row with temp ID
  const notes = addEnvelope ? setEnvelopeMarker('', true) : (form.notes ?? null);
  await db.insert(referenceAccounts).values({
    id: tempId,
    name: form.name.trim(),
    type: form.type,
    currencyCode: form.currencyCode,
    active: true,
    notes,
    accountRole: form.type === 'asset' ? (form.accountRole ?? 'defaultAsset') : null,
    includeNetWorth: form.type === 'asset' ? form.includeNetWorth : true,
    openingBalance: form.openingBalance ?? null,
    openingBalanceDate: form.openingBalanceDate ?? null,
    virtualBalance: null,
    creditCardType: form.type === 'asset' && form.accountRole === 'ccAsset' ? 'monthlyFull' : null,
    monthlyPaymentDate: form.monthlyPaymentDate ?? null,
    syncedAt: now,
  });

  // Enqueue the operation
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'create_account',
    payload: {
      tempId,
      form,
    },
  });

  return tempId;
}
```

**Update file:** `src/sync/payloadJson.ts`

Add to SCHEMAS:

```typescript
create_account: z.looseObject({
  v: version,
  tempId: z.string(), // Local UUID before server responds
  form: z.looseObject({
    name: z.string(),
    type: z.enum(['asset', 'liability', 'cash', 'revenue', 'expense']),
    accountRole: z.string().optional(),
    currencyCode: z.string(),
    includeNetWorth: z.boolean(),
    openingBalance: z.string().nullish(),
    openingBalanceDate: z.string().nullish(),
    notes: z.string().nullish(),
    interestRate: z.string().nullish(),
    creditLimit: z.string().nullish(),
    liabilityStartDate: z.string().nullish(),
    liabilityType: z.string().nullish(),
    liabilityDirection: z.enum(['debit', 'credit']).nullish(),
    paymentFrequency: z.string().nullish(),
    creditCardType: z.string().nullish(),
    monthlyPaymentDate: z.string().nullish(),
  }),
}),
```

**Update file:** `src/db/schema.ts`

In the outboxOperations enum, add `'create_account'` after `'reorder_accounts'` and before `'save_planned'`. Order matters per §11 of gap report:

```typescript
kind: text('kind', {
  enum: [
    'create_transaction',
    'update_transaction',
    'delete_transaction',
    'attach_receipt',
    'delete_attachment',
    'recurring_review',
    'update_account',
    'reorder_accounts',
    'create_account',  // ← NEW
    'save_planned',
    'delete_planned',
    'trigger_planned',
    'set_budget_limits',
    'set_piggy_amount',
  ],
}).notNull(),
```

**Update file:** `src/sync/outbox.ts`

Update OutboxKind union:

```typescript
export type OutboxKind =
  | 'create_transaction'
  | 'update_transaction'
  | 'delete_transaction'
  | 'attach_receipt'
  | 'delete_attachment'
  | 'recurring_review'
  | 'update_account'
  | 'reorder_accounts'
  | 'create_account'  // ← NEW
  | 'save_planned'
  | 'delete_planned'
  | 'trigger_planned'
  | 'set_budget_limits'
  | 'set_piggy_amount';
```

Add interface at top of outbox.ts:

```typescript
interface CreateAccountPayload {
  tempId: string;
  form: NewAccountForm;
}
```

Add replay logic (in the replay switch, after `reorder_accounts` and before `save_planned`):

```typescript
if (row.kind === 'create_account') {
  const p = payload as CreateAccountPayload;
  const { form } = p;
  const body = ff3CreateAccountBody(form);
  const created = await client.request<{ data: { id: string; attributes: unknown } }>(
    '/v1/accounts',
    { method: 'POST', body: JSON.stringify(body) },
  );
  const serverId = created.data.id;
  // Replace temp ID with server ID in reference_accounts
  await db.update(referenceAccounts).set({ id: serverId }).where(eq(referenceAccounts.id, p.tempId));
  // Update outbox subject (from account:${tempId} to account:${serverId})
  await recordCreated(db, row, { id: serverId });
  return 'done';
}
```

(Note: `recordCreated()` already exists for transactions; reuse it or add a variant.)

**Update file:** `src/sync/outboxSubjects.ts`

Add case in subjectsOf() switch:

```typescript
case 'create_account':
  add('account', p.tempId);
  break;
```

---

### Chunk 4: Tests

#### Unit Test: `src/accounts/accountCreate.test.ts` (new file)

```typescript
import {
  emptyNewAccountForm,
  newAccountFormProblem,
  ff3CreateAccountBody,
  FF3AccountType,
  NewAccountForm,
} from './accountCreate';

const baseAsset: NewAccountForm = {
  name: 'Savings',
  type: 'asset',
  accountRole: 'savingAsset',
  currencyCode: 'PLN',
  includeNetWorth: true,
  openingBalance: '1000.00',
  openingBalanceDate: '2026-01-01',
  notes: null,
  interestRate: null,
  creditLimit: null,
  liabilityStartDate: null,
  liabilityType: null,
  liabilityDirection: null,
  paymentFrequency: null,
  creditCardType: null,
  monthlyPaymentDate: null,
};

const baseLiability: NewAccountForm = {
  name: 'Personal Loan',
  type: 'liability',
  currencyCode: 'PLN',
  includeNetWorth: true,
  accountRole: undefined,
  openingBalance: null,
  openingBalanceDate: null,
  notes: null,
  interestRate: '5.00',
  creditLimit: null,
  liabilityStartDate: '2026-01-15',
  liabilityType: 'loan',
  liabilityDirection: 'debit',
  paymentFrequency: 'monthly',
  creditCardType: null,
  monthlyPaymentDate: null,
};

describe('newAccountFormProblem', () => {
  it('requires a name', () => {
    expect(newAccountFormProblem({ ...baseAsset, name: '' })).toBe('name');
    expect(newAccountFormProblem({ ...baseAsset, name: '  ' })).toBe('name');
    expect(newAccountFormProblem(baseAsset)).toBeNull();
  });

  it('requires a currency code', () => {
    expect(newAccountFormProblem({ ...baseAsset, currencyCode: '' })).toBe('currencyCode');
    expect(newAccountFormProblem(baseAsset)).toBeNull();
  });

  it('requires opening-balance date with an opening balance', () => {
    expect(newAccountFormProblem({ ...baseAsset, openingBalanceDate: null })).toBe(
      'openingBalanceDate',
    );
    expect(newAccountFormProblem({ ...baseAsset, openingBalance: null })).toBeNull();
  });

  it('requires monthly payment date for credit cards', () => {
    const card = { ...baseAsset, accountRole: 'ccAsset' as const, monthlyPaymentDate: null };
    expect(newAccountFormProblem(card)).toBe('monthlyPaymentDate');
    expect(newAccountFormProblem({ ...card, monthlyPaymentDate: '2026-10-15' })).toBeNull();
  });
});

describe('ff3CreateAccountBody', () => {
  it('sends required fields for assets', () => {
    const body = ff3CreateAccountBody(baseAsset);
    expect(body).toEqual({
      name: 'Savings',
      account_type: 'asset',
      currency_code: 'PLN',
      account_role: 'savingAsset',
      include_net_worth: true,
      opening_balance: '1000.00',
      opening_balance_date: '2026-01-01',
    });
  });

  it('adds credit card fields when role is ccAsset', () => {
    const card = { ...baseAsset, accountRole: 'ccAsset' as const, monthlyPaymentDate: '2026-10-15' };
    const body = ff3CreateAccountBody(card);
    expect(body.credit_card_type).toBe('monthlyFull');
    expect(body.monthly_payment_date).toBe('2026-10-15');
  });

  it('sends liability fields for liability type', () => {
    const body = ff3CreateAccountBody(baseLiability);
    expect(body).toEqual({
      name: 'Personal Loan',
      account_type: 'liability',
      currency_code: 'PLN',
      liability_type: 'loan',
      liability_direction: 'debit',
      interest: '5.00',
      liability_start_date: '2026-01-15',
      payment_frequency: 'monthly',
    });
  });

  it('omits optional fields that are null or empty', () => {
    const minimal: NewAccountForm = {
      name: 'Simple Account',
      type: 'revenue',
      currencyCode: 'EUR',
      includeNetWorth: false,
      accountRole: undefined,
      openingBalance: null,
      openingBalanceDate: null,
      notes: null,
      interestRate: null,
      creditLimit: null,
      liabilityStartDate: null,
      liabilityType: null,
      liabilityDirection: null,
      paymentFrequency: null,
      creditCardType: null,
      monthlyPaymentDate: null,
    };
    const body = ff3CreateAccountBody(minimal);
    expect(body).toEqual({
      name: 'Simple Account',
      account_type: 'revenue',
      currency_code: 'EUR',
    });
    expect(body.opening_balance).toBeUndefined();
    expect(body.notes).toBeUndefined();
  });
});
```

#### Screen Test: `src/__screens__/account.new.test.tsx` (new file)

```typescript
// Minimal screen test for new-account form rendering and basic flow.
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { createTestDb } from '../db/testDb';
import { referenceCurrencies } from '../db/schema';
import NewAccountScreen from '../../app/accounts/new';

let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));
jest.mock('../db/useReferenceData', () => ({
  useCurrencies: () => mockDb.select().from(referenceCurrencies).all(),
}));
jest.mock('../../src/ui/navigateOnce', () => ({ navigateOnce: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

beforeAll(() => {
  mockDb = createTestDb();
  mockDb
    .insert(referenceCurrencies)
    .values([
      { code: 'PLN', symbol: 'zł', decimalPlaces: 2, isDefault: true, enabled: true, syncedAt: new Date().toISOString() },
      { code: 'EUR', symbol: '€', decimalPlaces: 2, isDefault: false, enabled: true, syncedAt: new Date().toISOString() },
    ])
    .run();
});

it('renders the new-account form', () => {
  render(
    <SafeAreaProvider>
      <NewAccountScreen />
    </SafeAreaProvider>,
  );
  expect(screen.getByText(/create/i)).toBeTruthy();
});

it('shows liability fields when type is changed to liability', () => {
  render(
    <SafeAreaProvider>
      <NewAccountScreen />
    </SafeAreaProvider>,
  );
  // This test is a placeholder; a full version would tap the type picker,
  // select 'liability', and verify fields appear.
});
```

#### Outbox Replay Test: `src/sync/outbox.test.ts` (update)

Add test case for create_account:

```typescript
it('replays create_account and updates temp ID to server ID', async () => {
  const tempId = generateId();
  const serverId = 'ff3-1234';
  
  // Insert temp row
  await db.insert(referenceAccounts).values({
    id: tempId,
    name: 'New Account',
    type: 'asset',
    currencyCode: 'PLN',
    active: true,
    syncedAt: new Date().toISOString(),
  });

  // Mock FF3 response
  client.request = jest.fn().mockResolvedValue({
    data: { id: serverId, attributes: { name: 'New Account' } },
  });

  // Enqueue the operation
  const opId = generateId();
  await db.insert(outboxOperations).values({
    id: opId,
    kind: 'create_account',
    payloadJson: writePayload({
      tempId,
      form: { name: 'New Account', type: 'asset', currencyCode: 'PLN', includeNetWorth: true },
    }),
    status: 'pending',
  });

  // Replay
  const result = await replayOne(db, client, opId);
  expect(result).toBe('done');

  // Verify server ID replaced temp ID
  const [updated] = await db.select().from(referenceAccounts).where(eq(referenceAccounts.id, serverId));
  expect(updated).toBeTruthy();
  expect(updated.name).toBe('New Account');

  // Verify operation removed
  const [remaining] = await db.select().from(outboxOperations).where(eq(outboxOperations.id, opId));
  expect(remaining).toBeUndefined();
});
```

---

### Chunk 5: Localization & Settings

**Update file:** `src/i18n/locales/en.json`

Add keys:

```json
{
  "account": {
    ...existing keys...,
    "createTitle": "New Account",
    "type": "Account Type",
    "type.asset": "Asset",
    "type.liability": "Liability",
    "type.cash": "Cash",
    "type.revenue": "Revenue",
    "type.expense": "Expense",
    "role.defaultAsset": "Default Asset",
    "role.savingAsset": "Savings",
    "role.ccAsset": "Credit Card",
    "role.cashWalletAsset": "Cash Wallet",
    "role.sharedAsset": "Shared Asset",
    "sectionOpeningBalance": "Opening Balance",
    "openingBalance": "Opening Balance",
    "pickDate": "Pick a date",
    "sectionLiability": "Liability Details",
    "liabilityType": "Liability Type",
    "liabilityType.loan": "Loan",
    "liabilityType.debt": "Debt",
    "liabilityType.mortgage": "Mortgage",
    "liabilityType.credit": "Credit",
    "liabilityDirection": "Direction",
    "direction.debit": "Debit",
    "direction.credit": "Credit",
    "interestRate": "Interest Rate (%)",
    "creditLimit": "Credit Limit",
    "liabilityStartDate": "Start Date",
    "paymentFrequency": "Payment Frequency",
    "frequency.weekly": "Weekly",
    "frequency.biweekly": "Bi-weekly",
    "frequency.monthly": "Monthly",
    "frequency.bimonthly": "Bi-monthly",
    "frequency.quarterly": "Quarterly",
    "frequency.yearly": "Yearly",
    "selectType": "Select type",
    "selectDirection": "Select direction",
    "selectFrequency": "Select frequency",
    "problemName": "Please enter a name",
    "problemCurrency": "Please select a currency",
  },
  "accounts": {
    ...existing keys...
  }
}
```

**Update file:** `src/i18n/locales/uk-UA.json`, `pt-BR.json`, etc.

Add the same keys empty (to be filled by Tolgee):

```json
{
  "account": {
    "createTitle": "",
    "type": "",
    "type.asset": "",
    ... (all the new keys empty)
  }
}
```

**Update file:** `app/settings/accounts.tsx`

Add "+" button to app bar:

```typescript
export default function AccountsScreen() {
  // ... existing code ...
  const addAccount = () => navigateOnce('/accounts/new');

  return (
    <Screen bottom avoidKeyboard>
      <View style={{ flex: 1 }}>
        <AppBar
          title={tr('accounts.title')}
          left={<CloseButton onPress={close} />}
          right={
            reordering ? (
              <Button onPress={done} label={tr('common.done')} />
            ) : (
              <BarIconButton onPress={addAccount} icon="plus-circle" />
            )
          }
        />
        {/* ... rest of screen ... */}
      </View>
    </Screen>
  );
}
```

---

### Chunk 6: CHANGELOG & Maestro Flow

**Update file:** `CHANGELOG.md`

Under `[Unreleased]`:

```markdown
### Added
- **Account Creation**: Create new asset and liability accounts directly from the app. Set up liability details (interest rate, credit limit, payment frequency). Asset accounts support credit card roles with payment dates.
```

**New Maestro flow:** `.maestro/flows/accounts/A1-create-account.yaml`

```yaml
appId: ${APP_ID}
name: 'A1 · Create account'
tags:
  - smoke
---
- runFlow: ../../subflows/ready.yaml

# Navigate to Settings → Accounts
- tapOn: 'Settings, tab, 5 of 5'
- tapOn: 'Asset Accounts'

# Tap the + button to create new account
- tapOn:
    id: 'plus-circle'

# Fill form for a new asset account
- assertVisible: 'New Account'
- tapOn:
    label: 'Savings Account'
- hideKeyboard
- tapOn: 'Account Type'
- tapOn: 'Asset'
- tapOn: 'Currency'
- tapOn: 'EUR'

# Fill name
- tapOn:
    text: 'Name'
    index: 0
- inputText: 'A1 ${RUN_ID}'
- hideKeyboard

# Set opening balance
- tapOn: 'Opening Balance'
- inputText: '1000.00'
- hideKeyboard

# Save
- tapOn: 'Save'
- extendedWaitUntil:
    visible: 'A1 ${RUN_ID}'
    timeout: 10000

# Verify in FF3
- runScript:
    file: ../../scripts/ff3.js
    env:
      ACTION: expectAccount
      NAME: 'A1 ${RUN_ID}'
      EXPECT_ACTIVE: 'true'
      TIMEOUT_MS: '5000'

# Create a liability account
- tapOn: 'Account Type'
- tapOn: 'Liability'
- tapOn:
    text: 'Name'
    index: 0
- inputText: 'Loan A1 ${RUN_ID}'
- hideKeyboard
- tapOn: 'Liability Type'
- tapOn: 'Loan'
- tapOn:
    text: 'Interest Rate'
    index: 0
- inputText: '4.50'
- hideKeyboard
- tapOn: 'Save'
- extendedWaitUntil:
    visible: 'Loan A1 ${RUN_ID}'
    timeout: 10000

# Verify liability in FF3
- runScript:
    file: ../../scripts/ff3.js
    env:
      ACTION: expectAccount
      NAME: 'Loan A1 ${RUN_ID}'
      EXPECT_ACTIVE: 'true'
      TIMEOUT_MS: '5000'
```

Register in `scripts/e2e.mjs` FLOWS:

```javascript
{
  id: 'A1',
  tier: 'smoke',
  title: 'Create account',
  steps: ['accounts/A1-create-account.yaml'],
  areas: ['app/accounts/', 'src/accounts/accountCreate.ts', 'src/sync/outbox.ts'],
},
```

---

## Implementation Chunks by Agent

### Chunk 1 (Small): Form Logic & Types (~15k tokens)
- File: `src/accounts/accountCreate.ts` (new)
- File: `src/accounts/accountActions.ts` (update: add `createAccount()`)
- Test: `src/accounts/accountCreate.test.ts` (new)

**Deliverables:** Types, validation, FF3 body builder, `createAccount()` function, unit tests passing.

### Chunk 2 (Medium): Screen Implementation (~35k tokens)
- File: `app/accounts/new.tsx` (new)
- File: `app/settings/accounts.tsx` (update: add + button)
- Update: `src/i18n/locales/*.json` (all 5 locales)
- Test: `src/__screens__/account.new.test.tsx` (new)

**Deliverables:** Full new-account screen, i18n keys added, screen test passing, no typecheck errors.

### Chunk 3 (Small): Outbox & Replay (~20k tokens)
- File: `src/db/schema.ts` (update: enum)
- File: `src/sync/outbox.ts` (update: kind, types, replay logic)
- File: `src/sync/payloadJson.ts` (update: SCHEMAS)
- File: `src/sync/outboxSubjects.ts` (update: case)
- Test: `src/sync/outbox.test.ts` (update: add create_account test)

**Deliverables:** Enum registered in 4 places, replay logic, payload validation, subject blocking, outbox tests passing.

### Chunk 4 (Very Small): Polish & E2E (~10k tokens)
- File: `CHANGELOG.md` (update)
- File: `.maestro/flows/accounts/A1-create-account.yaml` (new)
- File: `scripts/e2e.mjs` (update: register flow)

**Deliverables:** CHANGELOG entry, Maestro flow, E2E registration.

---

## Key Code Patterns to Follow

### 1. How to build the FF3 request body for creates
```typescript
// From accountCreate.ts ff3CreateAccountBody()
const body: Record<string, unknown> = {
  name: form.name.trim(),
  account_type: form.type,
  currency_code: form.currencyCode,
};
if (form.type === 'asset') {
  body.account_role = form.accountRole ?? 'defaultAsset';
  // ... asset-specific fields
}
if (form.type === 'liability') {
  // ... liability-specific fields
}
return body;
```

### 2. How to enqueue an operation with temp ID
```typescript
// From accountActions.ts createAccount()
const tempId = generateId();
await db.insert(referenceAccounts).values({ id: tempId, ... });
await enqueueOperation(db, {
  id: generateId(),
  kind: 'create_account',
  payload: { tempId, form },
});
```

### 3. How to replay and update temp ID to server ID
```typescript
// In outbox.ts replay switch
if (row.kind === 'create_account') {
  const created = await client.request(/* POST /v1/accounts */);
  const serverId = created.data.id;
  await db.update(referenceAccounts).set({ id: serverId }).where(eq(referenceAccounts.id, p.tempId));
  await recordCreated(db, row, { id: serverId });
  // ...
}
```

### 4. How to add i18n keys
```json
{
  "account": {
    "createTitle": "New Account",
    "type.asset": "Asset",
    "type.liability": "Liability"
  }
}
```
Then in every other locale file, add the same key with empty string value (Tolgee fills it).

### 5. Screen test setup (using testDb)
```typescript
let mockDb: ReturnType<typeof createTestDb>;
jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));
beforeAll(() => {
  mockDb = createTestDb();
  mockDb.insert(...).values(...).run();
});
it('renders', () => {
  render(<SafeAreaProvider><NewAccountScreen /></SafeAreaProvider>);
  expect(screen.getByText(/expected text/)).toBeTruthy();
});
```

---

## Verification Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run test src/accounts/accountCreate.test.ts` passes
- [ ] `npm run test src/sync/outbox.test.ts` (new create_account case) passes
- [ ] `npm run test src/__screens__/account.new.test.tsx` passes
- [ ] `npm run db:migrations.upgrade.test.ts` passes (no new migrations added, just enum)
- [ ] All i18n keys present in all 5 locale files (5 files, no missing keys)
- [ ] Outbox kind registered in exactly 4 places: schema enum, OutboxKind union, payloadJson SCHEMAS, outboxSubjects switch
- [ ] `npm run analyze` reports no new dead code or import cycles
- [ ] Maestro flow runs: `npm run e2e -- A1` against test instance (fresh seed)
- [ ] E2E creates both asset and liability accounts, verifies in FF3, sees them in Settings

---

## Open Questions & Notes

1. **Envelope marker for new accounts:** Currently only applies if `addEnvelope` is true in `createAccount()`. This is set from the "Cash envelope" checkbox on the screen. The marker is the `mmyway-envelope` line in notes, applied before sending to outbox.

2. **Liability fields no round-trip.** When creating a liability, the app sends `interest_rate`, `credit_limit`, etc. to FF3 via POST. On the next sync pull, FF3 returns them, but the app currently only caches `name`, `type`, `currencyCode`, etc. in reference_accounts. **Decision:** Liability field values (interest, limit, frequency) are not cached locally; they live only on FF3. If the user wants to see/edit them later, a future screen would need to add columns to reference_accounts (migration + schema update).

3. **No "revenue/expense" account editing.** The form allows creating Revenue/Expense accounts (payee types) but they have no edit screen yet. Only asset and liability accounts route to `app/accounts/[id].tsx`. Future: add editing for payees if needed.

4. **Credit card liability handling.** FF3's credit card is an asset account (type=asset, account_role=ccAsset), not a liability. The app does NOT create credit cards as liabilities; it creates them as assets (with ccAsset role). Liabilities are separate accounts (type=liability, liability_type=credit) if they model credit lines.

5. **Maestro flow assumes seed has default currency.** The flow creates accounts in EUR and PLN, assuming both are in the test instance seed. If seed changes, update the flow.

---

## Token Estimate by Chunk

| Chunk | Task | Tokens | Notes |
|-------|------|--------|-------|
| 1 | Form logic, types, validation, tests | 15k | `accountCreate.ts` + unit tests |
| 2 | Screen, UI, i18n, screen tests | 35k | `new.tsx` + all 5 locales + render tests |
| 3 | Outbox, replay, payload schema | 20k | Four registration sites, replay logic, outbox tests |
| 4 | CHANGELOG, Maestro, E2E registration | 10k | Documentation, flow YAML, FLOWS entry |
| **Total** | | **80k** | Fits in one agent per chunk |

