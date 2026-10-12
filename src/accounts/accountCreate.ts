// Creates an FF3 account from the device. Like every other write it lands in the local cache at once
// under a temporary `mmyway-*` id and is queued as a create_account operation; the replay POSTs it to
// FF3 and swaps FF3's id in everywhere the temporary one is still queued (budgetActions.ts does the same
// for envelopes).
import { and, eq, inArray } from 'drizzle-orm';
import { FF3RequestError, type FF3Client } from '../api/ff3/client';
import { parseDecimalInput, parseSignedDecimalInput } from '../api/ff3/decimal';
import { fetchAllPages } from '../api/ff3/paginate';
import { outboxOperations, referenceAccounts } from '../db/schema';
import {
  enqueueOperation,
  isUnsent,
  type OutboxDb,
  type ReorderAccountsPayload,
  type UpdateAccountPayload,
} from '../sync/outbox';
import { readPayload, writePayload } from '../sync/payloadJson';
import { generateId } from '../utils/id';
import { accountFormProblem, CREDIT_CARD_TYPE, type AccountRole } from './accountEdit';

export interface AccountCreateForm {
  name: string;
  type: 'asset' | 'liability';
  currencyCode: string;
  openingBalance?: string | null; // canonical decimal, e.g. '1250.00'
  openingBalanceDate?: string | null; // YYYY-MM-DD
  notes?: string | null;
  // asset only
  accountRole?: AccountRole;
  includeNetWorth?: boolean;
  creditCardType?: string | null; // ccAsset; defaults to FF3's monthlyFull
  monthlyPaymentDate?: string | null; // ccAsset, YYYY-MM-DD
  // liability only
  liabilityType?: 'loan' | 'debt' | 'mortgage' | null;
  liabilityDirection?: 'credit' | 'debit' | null;
  interest?: string | null; // canonical decimal
  interestPeriod?: 'weekly' | 'monthly' | 'quarterly' | 'half-year' | 'yearly' | null;
  virtualBalance?: string | null; // canonical decimal; the credit limit
}

export interface CreateAccountPayload {
  clientId: string; // becomes the temporary row id; serverId is recorded once FF3 answers
  form: AccountCreateForm;
  serverId?: string;
}

export type AccountCreateProblem =
  | 'name'
  | 'currencyCode'
  | 'openingBalance'
  | 'openingBalanceDate'
  | 'monthlyPaymentDate'
  | 'liabilityType'
  | 'liabilityDirection'
  | 'interest'
  | 'virtualBalance';

/** A canonical FF3 amount: what the form's decimal input produces, nothing to be guessed at. */
function isAmount(value: string, signed: boolean): boolean {
  const trimmed = value.trim();
  const result = signed ? parseSignedDecimalInput(trimmed) : parseDecimalInput(trimmed);
  return result.ok && result.value === trimmed;
}

/** Why the form can't be saved yet, or null. */
export function accountCreateProblem(form: AccountCreateForm): AccountCreateProblem | null {
  const asset = form.type === 'asset';
  const shared = accountFormProblem({
    name: form.name,
    currencyCode: form.currencyCode,
    accountRole: asset ? (form.accountRole ?? 'defaultAsset') : 'defaultAsset',
    includeNetWorth: form.includeNetWorth ?? true,
    openingBalance: form.openingBalance ?? null,
    openingBalanceDate: form.openingBalanceDate ?? null,
    virtualBalance: null,
    creditCardType: form.creditCardType ?? null,
    monthlyPaymentDate: form.monthlyPaymentDate ?? null,
  });
  if (shared) return shared;
  if (!form.currencyCode.trim()) return 'currencyCode';
  if (form.openingBalance && !isAmount(form.openingBalance, true)) return 'openingBalance';
  if (!asset) {
    if (!form.liabilityType) return 'liabilityType';
    if (!form.liabilityDirection) return 'liabilityDirection';
    if (form.interest && !isAmount(form.interest, false)) return 'interest';
    if (form.virtualBalance && !isAmount(form.virtualBalance, false)) return 'virtualBalance';
  }
  return null;
}

/** The FF3 `POST /v1/accounts` body. Asset and liability keys are disjoint, as FF3 reads them. */
export function ff3CreateAccountBody(form: AccountCreateForm): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    type: form.type,
    currency_code: form.currencyCode,
    active: true,
  };
  if (form.openingBalance) {
    body.opening_balance = form.openingBalance;
    body.opening_balance_date = form.openingBalanceDate;
  }
  if (form.notes) body.notes = form.notes;
  if (form.type === 'asset') {
    const role = form.accountRole ?? 'defaultAsset';
    body.account_role = role;
    body.include_net_worth = form.includeNetWorth ?? true;
    if (role === 'ccAsset') {
      body.credit_card_type = form.creditCardType ?? CREDIT_CARD_TYPE;
      body.monthly_payment_date = form.monthlyPaymentDate;
    }
  } else {
    body.liability_type = form.liabilityType;
    body.liability_direction = form.liabilityDirection;
    if (form.interest) body.interest = form.interest;
    if (form.interestPeriod) body.interest_period = form.interestPeriod;
    if (form.virtualBalance) body.virtual_balance = form.virtualBalance;
  }
  return body;
}

/** The reference_accounts row a create writes, from the form alone (used before and after FF3 answers). */
function localRow(id: string, form: AccountCreateForm, now: string) {
  const asset = form.type === 'asset';
  const card = asset && form.accountRole === 'ccAsset';
  return {
    id,
    name: form.name.trim(),
    type: form.type,
    currencyCode: form.currencyCode,
    active: true,
    currentBalance: form.openingBalance || '0',
    currentBalanceDate: null,
    notes: form.notes || null,
    accountRole: asset ? (form.accountRole ?? 'defaultAsset') : null,
    includeNetWorth: asset ? (form.includeNetWorth ?? true) : true,
    openingBalance: form.openingBalance || null,
    openingBalanceDate: form.openingBalance ? (form.openingBalanceDate ?? null) : null,
    virtualBalance: asset ? null : form.virtualBalance || null,
    creditCardType: card ? (form.creditCardType ?? CREDIT_CARD_TYPE) : null,
    monthlyPaymentDate: card ? (form.monthlyPaymentDate ?? null) : null,
    syncedAt: now,
  };
}

/**
 * Create an account and queue the operation. The account shows at once under its temporary `mmyway-*`
 * id; the create's replay swaps in FF3's id. Returns the temporary id.
 */
export async function enqueueAccountCreate(db: OutboxDb, form: AccountCreateForm): Promise<string> {
  const clientId = `mmyway-${generateId()}`;
  const payload: CreateAccountPayload = { clientId, form };
  await db.insert(referenceAccounts).values(localRow(clientId, form, new Date().toISOString()));
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'create_account',
    payload,
  });
  return clientId;
}

interface AccountResponse {
  id: string;
  attributes: Record<string, unknown>;
}

async function fetchAccount(client: FF3Client, accountId: string): Promise<AccountResponse | null> {
  try {
    const response = await client.request<{
      data?: { id?: string | number; attributes?: Record<string, unknown> };
    }>(`/v1/accounts/${accountId}`);
    if (response?.data?.id != null) {
      return { id: String(response.data.id), attributes: response.data.attributes ?? {} };
    }
    return null;
  } catch (err) {
    if (err instanceof FF3RequestError && err.status === 404) return null;
    throw err;
  }
}

/** Finds an existing account of the same name and type (for a 422 duplicate). */
async function findAccountByName(
  client: FF3Client,
  form: AccountCreateForm,
): Promise<AccountResponse | null> {
  // FF3 lists liabilities under `liabilities` (src/sync/referenceData.ts pulls them the same way).
  const type = form.type === 'liability' ? 'liabilities' : 'asset';
  const accounts = await fetchAllPages<{
    id?: string | number;
    attributes?: Record<string, unknown>;
  }>(client, `/v1/accounts?type=${type}`);
  const wanted = form.name.trim();
  const found = accounts.find((a) => String(a.attributes?.name ?? '').trim() === wanted);
  if (found?.id == null) return null;
  return { id: String(found.id), attributes: found.attributes ?? {} };
}

/**
 * Replay a create_account operation: POST to /v1/accounts. On 422 (a duplicate name of the same type)
 * adopt the existing account. Records FF3's id in the operation, then swaps it in for the temporary one.
 */
export async function replayCreateAccount(
  db: OutboxDb,
  client: FF3Client,
  opId: string,
  payload: CreateAccountPayload,
): Promise<void> {
  let account = payload.serverId ? await fetchAccount(client, payload.serverId) : null;

  if (!account) {
    try {
      const response = await client.request<{
        data?: { id?: string | number; attributes?: Record<string, unknown> };
      }>('/v1/accounts', {
        method: 'POST',
        body: JSON.stringify(ff3CreateAccountBody(payload.form)),
      });
      if (response?.data?.id != null) {
        account = {
          id: String(response.data.id),
          attributes: response.data.attributes ?? {},
        };
      }
    } catch (err) {
      if (err instanceof FF3RequestError && err.status === 422) {
        account = await findAccountByName(client, payload.form);
        if (!account) throw err;
      } else {
        throw err;
      }
    }
  }
  if (!account) throw new Error('Firefly III did not return the new account');

  if (account.id !== payload.serverId) {
    const updated: CreateAccountPayload = { ...payload, serverId: account.id };
    await db
      .update(outboxOperations)
      .set({ payloadJson: writePayload(updated) })
      .where(eq(outboxOperations.id, opId));
  }

  await swapAccountId(db, payload.clientId, account, payload.form);
}

/**
 * The create just learned FF3's id for an account known so far by its `mmyway-*` id: moves the cached
 * row and every queued unsent edit or reorder still pointing at the temporary id over to the real one.
 */
async function swapAccountId(
  db: OutboxDb,
  clientId: string,
  account: AccountResponse,
  form: AccountCreateForm,
): Promise<void> {
  const now = new Date().toISOString();
  const row = localRow(account.id, form, now);
  const balance = account.attributes.current_balance;
  if (typeof balance === 'string') row.currentBalance = balance;
  await db.delete(referenceAccounts).where(eq(referenceAccounts.id, clientId));
  await db
    .insert(referenceAccounts)
    .values(row)
    .onConflictDoUpdate({ target: referenceAccounts.id, set: row });

  const ops = await db
    .select()
    .from(outboxOperations)
    .where(and(inArray(outboxOperations.kind, ['update_account', 'reorder_accounts']), isUnsent()));
  for (const op of ops) {
    let next: object | null = null;
    if (op.kind === 'reorder_accounts') {
      const p = readPayload<ReorderAccountsPayload>(op.kind, op.payloadJson);
      if (p.orderedIds.includes(clientId)) {
        next = {
          ...p,
          orderedIds: p.orderedIds.map((id) => (id === clientId ? account.id : id)),
        };
      }
    } else {
      const p = readPayload<UpdateAccountPayload>(op.kind, op.payloadJson);
      if (p.accountId === clientId) next = { ...p, accountId: account.id };
    }
    if (next) {
      await db
        .update(outboxOperations)
        .set({ payloadJson: writePayload(next) })
        .where(eq(outboxOperations.id, op.id));
    }
  }
}
