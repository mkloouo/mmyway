import { createTestDb } from '../db/testDb';
import { outboxOperations, referenceAccounts } from '../db/schema';
import { FF3RequestError } from '../api/ff3/client';
import { readPayload } from '../sync/payloadJson';
import { updateAccount, reorderAccounts } from './accountActions';
import {
  accountCreateProblem,
  enqueueAccountCreate,
  ff3CreateAccountBody,
  replayCreateAccount,
  type AccountCreateForm,
  type CreateAccountPayload,
} from './accountCreate';

const asset: AccountCreateForm = {
  name: ' Checking ',
  type: 'asset',
  currencyCode: 'PLN',
  accountRole: 'defaultAsset',
  includeNetWorth: true,
  openingBalance: '1250.00',
  openingBalanceDate: '2026-10-01',
  notes: 'main',
};

const liability: AccountCreateForm = {
  name: 'Mortgage',
  type: 'liability',
  currencyCode: 'PLN',
  openingBalance: '200000.00',
  openingBalanceDate: '2026-01-01',
  liabilityType: 'mortgage',
  liabilityDirection: 'debit',
  interest: '3.50',
  interestPeriod: 'yearly',
  virtualBalance: '5000.00',
};

/** A fake FF3 client: records every call and its JSON body, answers from `handle`. */
function fakeFF3(handle: (path: string, init?: any) => unknown) {
  const calls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const client = {
    request: async (path: string, init?: any) => {
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (init?.body) bodies.push(JSON.parse(init.body));
      return handle(path, init);
    },
  };
  return { client: client as any, calls, bodies };
}

const created = (id: string, attributes: Record<string, unknown> = {}) => ({
  data: { id, attributes: { name: 'Checking', currency_code: 'PLN', active: true, ...attributes } },
});

describe('accountCreateProblem', () => {
  it('accepts a complete asset and a complete liability', () => {
    expect(accountCreateProblem(asset)).toBeNull();
    expect(accountCreateProblem(liability)).toBeNull();
  });

  it('asks for a name and a currency', () => {
    expect(accountCreateProblem({ ...asset, name: '   ' })).toBe('name');
    expect(accountCreateProblem({ ...asset, currencyCode: '' })).toBe('currencyCode');
  });

  it('asks for an opening balance date with an opening balance', () => {
    expect(accountCreateProblem({ ...asset, openingBalanceDate: null })).toBe('openingBalanceDate');
  });

  it('rejects an amount that is not a canonical decimal', () => {
    expect(accountCreateProblem({ ...asset, openingBalance: '12,50' })).toBe('openingBalance');
    expect(accountCreateProblem({ ...liability, interest: 'abc' })).toBe('interest');
    expect(accountCreateProblem({ ...liability, virtualBalance: '1.2.3' })).toBe('virtualBalance');
  });

  it('asks for the payment date on a credit card account', () => {
    expect(accountCreateProblem({ ...asset, accountRole: 'ccAsset' })).toBe('monthlyPaymentDate');
    expect(
      accountCreateProblem({ ...asset, accountRole: 'ccAsset', monthlyPaymentDate: '2026-11-05' }),
    ).toBeNull();
  });

  it('asks for a liability type and direction', () => {
    expect(accountCreateProblem({ ...liability, liabilityType: null })).toBe('liabilityType');
    expect(accountCreateProblem({ ...liability, liabilityDirection: null })).toBe(
      'liabilityDirection',
    );
  });
});

describe('ff3CreateAccountBody', () => {
  it('sends the asset keys and nothing liability-only', () => {
    expect(ff3CreateAccountBody(asset)).toEqual({
      name: 'Checking',
      type: 'asset',
      currency_code: 'PLN',
      active: true,
      opening_balance: '1250.00',
      opening_balance_date: '2026-10-01',
      notes: 'main',
      account_role: 'defaultAsset',
      include_net_worth: true,
    });
  });

  it('sends the card type and payment date for a credit card', () => {
    const body = ff3CreateAccountBody({
      ...asset,
      accountRole: 'ccAsset',
      monthlyPaymentDate: '2026-11-05',
    });
    expect(body).toMatchObject({
      account_role: 'ccAsset',
      credit_card_type: 'monthlyFull',
      monthly_payment_date: '2026-11-05',
    });
  });

  it('sends the liability keys and no asset role', () => {
    expect(ff3CreateAccountBody(liability)).toEqual({
      name: 'Mortgage',
      type: 'liability',
      currency_code: 'PLN',
      active: true,
      opening_balance: '200000.00',
      opening_balance_date: '2026-01-01',
      liability_type: 'mortgage',
      liability_direction: 'debit',
      interest: '3.50',
      interest_period: 'yearly',
      virtual_balance: '5000.00',
    });
  });
});

describe('enqueueAccountCreate', () => {
  it('shows the account at once under a temporary id and queues a create_account', async () => {
    const db = createTestDb();
    const clientId = await enqueueAccountCreate(db, asset);
    expect(clientId).toMatch(/^mmyway-/);

    expect(await db.select().from(referenceAccounts)).toEqual([
      expect.objectContaining({
        id: clientId,
        name: 'Checking',
        type: 'asset',
        active: true,
        currentBalance: '1250.00',
        openingBalance: '1250.00',
      }),
    ]);

    const ops = await db.select().from(outboxOperations);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.kind).toBe('create_account');
    expect(readPayload<CreateAccountPayload>(ops[0]!.kind, ops[0]!.payloadJson)).toEqual({
      clientId,
      form: asset,
    });
  });
});

describe('replayCreateAccount', () => {
  it('POSTs the asset body, swaps the temporary row for FF3s and records the server id', async () => {
    const db = createTestDb();
    await enqueueAccountCreate(db, asset);
    const op = (await db.select().from(outboxOperations))[0]!;
    const { client, calls, bodies } = fakeFF3((path, init) => {
      if (path === '/v1/accounts' && init?.method === 'POST') return created('77');
      throw new Error(`unexpected request: ${path}`);
    });

    await replayCreateAccount(
      db,
      client,
      op.id,
      readPayload<CreateAccountPayload>(op.kind, op.payloadJson),
    );

    expect(calls).toEqual(['POST /v1/accounts']);
    expect(bodies[0]).toEqual(ff3CreateAccountBody(asset));
    expect((await db.select().from(referenceAccounts)).map((r) => r.id)).toEqual(['77']);
    const after = await db.select().from(outboxOperations);
    expect(readPayload<CreateAccountPayload>(after[0]!.kind, after[0]!.payloadJson).serverId).toBe(
      '77',
    );
  });

  it('POSTs a liability to the same endpoint with the liability keys', async () => {
    const db = createTestDb();
    await enqueueAccountCreate(db, liability);
    const op = (await db.select().from(outboxOperations))[0]!;
    const { bodies, client } = fakeFF3(() =>
      created('78', { name: 'Mortgage', type: 'liability' }),
    );

    await replayCreateAccount(
      db,
      client,
      op.id,
      readPayload<CreateAccountPayload>(op.kind, op.payloadJson),
    );

    expect(bodies[0]).toMatchObject({
      type: 'liability',
      liability_type: 'mortgage',
      liability_direction: 'debit',
      interest_period: 'yearly',
    });
    const rows = await db.select().from(referenceAccounts);
    expect(rows).toEqual([expect.objectContaining({ id: '78', type: 'liability' })]);
  });

  it('adopts the existing asset of the same name on a 422 duplicate', async () => {
    const db = createTestDb();
    await enqueueAccountCreate(db, asset);
    const op = (await db.select().from(outboxOperations))[0]!;
    const { client, calls } = fakeFF3((path, init) => {
      if (init?.method === 'POST') throw new FF3RequestError(422, 'Duplicate', 'POST /v1/accounts');
      if (path.startsWith('/v1/accounts?type=asset')) {
        return {
          data: [
            { id: '55', attributes: { name: 'Savings' } },
            { id: '56', attributes: { name: 'Checking' } },
          ],
        };
      }
      throw new Error(`unexpected request: ${path}`);
    });

    await replayCreateAccount(
      db,
      client,
      op.id,
      readPayload<CreateAccountPayload>(op.kind, op.payloadJson),
    );

    expect(calls[0]).toBe('POST /v1/accounts');
    expect(calls[1]).toMatch(/^GET \/v1\/accounts\?type=asset/);
    expect((await db.select().from(referenceAccounts)).map((r) => r.id)).toEqual(['56']);
    const after = await db.select().from(outboxOperations);
    expect(readPayload<CreateAccountPayload>(after[0]!.kind, after[0]!.payloadJson).serverId).toBe(
      '56',
    );
  });

  it('looks up liabilities under FF3s liabilities type on a 422', async () => {
    const db = createTestDb();
    await enqueueAccountCreate(db, liability);
    const op = (await db.select().from(outboxOperations))[0]!;
    const { client, calls } = fakeFF3((path, init) => {
      if (init?.method === 'POST') throw new FF3RequestError(422, 'Duplicate', 'POST /v1/accounts');
      if (path.startsWith('/v1/accounts?type=liabilities')) {
        return { data: [{ id: '90', attributes: { name: 'Mortgage' } }] };
      }
      throw new Error(`unexpected request: ${path}`);
    });

    await replayCreateAccount(
      db,
      client,
      op.id,
      readPayload<CreateAccountPayload>(op.kind, op.payloadJson),
    );

    expect(calls[1]).toMatch(/^GET \/v1\/accounts\?type=liabilities/);
    expect((await db.select().from(referenceAccounts)).map((r) => r.id)).toEqual(['90']);
  });

  it('keeps the 422 when no account of that name exists', async () => {
    const db = createTestDb();
    await enqueueAccountCreate(db, asset);
    const op = (await db.select().from(outboxOperations))[0]!;
    const { client } = fakeFF3((path, init) => {
      if (init?.method === 'POST') throw new FF3RequestError(422, 'Invalid', 'POST /v1/accounts');
      return { data: [] };
    });

    await expect(
      replayCreateAccount(
        db,
        client,
        op.id,
        readPayload<CreateAccountPayload>(op.kind, op.payloadJson),
      ),
    ).rejects.toBeInstanceOf(FF3RequestError);
    // The temporary row stays, so the account still shows and the operation can be retried.
    expect((await db.select().from(referenceAccounts)).map((r) => r.id)[0]).toMatch(/^mmyway-/);
  });

  it('does not create the account twice once its server id is recorded', async () => {
    const db = createTestDb();
    await enqueueAccountCreate(db, asset);
    const op = (await db.select().from(outboxOperations))[0]!;
    const payload = {
      ...readPayload<CreateAccountPayload>(op.kind, op.payloadJson),
      serverId: '77',
    };
    const { client, calls } = fakeFF3((path, init) => {
      if (path === '/v1/accounts/77' && !init?.method) return created('77');
      throw new Error(`unexpected request: ${path}`);
    });

    await replayCreateAccount(db, client, op.id, payload);

    expect(calls).toEqual(['GET /v1/accounts/77']);
    expect((await db.select().from(referenceAccounts)).map((r) => r.id)).toEqual(['77']);
  });

  it('moves queued account edits and reorders from the temporary id to FF3s', async () => {
    const db = createTestDb();
    const clientId = await enqueueAccountCreate(db, asset);
    db.update(outboxOperations).set({ status: 'in_flight' }).run();
    await updateAccount(db, clientId, { name: 'Cash' });
    await reorderAccounts(db, [clientId, 'other']);

    const { client } = fakeFF3((path, init) => {
      if (path === '/v1/accounts' && init?.method === 'POST') return created('77');
      throw new Error(`unexpected request: ${path}`);
    });
    const create = (await db.select().from(outboxOperations))[0]!;
    await replayCreateAccount(
      db,
      client,
      create.id,
      readPayload<CreateAccountPayload>(create.kind, create.payloadJson),
    );

    const ops = await db.select().from(outboxOperations);
    const update = ops.find((o) => o.kind === 'update_account')!;
    expect(readPayload(update.kind, update.payloadJson)).toEqual({
      accountId: '77',
      edit: { name: 'Cash' },
    });
    const reorder = ops.find((o) => o.kind === 'reorder_accounts')!;
    expect(readPayload(reorder.kind, reorder.payloadJson)).toEqual({
      orderedIds: ['77', 'other'],
    });
  });
});
