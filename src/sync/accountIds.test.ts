import { createTestDb } from '../db/testDb';
import { referenceAccounts } from '../db/schema';
import { accountResolver, withAccountIds } from './accountIds';
import { enqueueOperation, replayOutbox } from './outbox';

type Account = { id: string; attributes: { name: string; type: string } };

function fakeFF3(accounts: Account[]) {
  let nextId = 100;
  const request = jest.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
    if (path.startsWith('/v1/search/accounts')) {
      const query = new URLSearchParams(path.split('?')[1]).get('query')!.toLowerCase();
      return { data: accounts.filter((a) => a.attributes.name.toLowerCase().includes(query)) };
    }
    if (path === '/v1/accounts' && init?.method === 'POST') {
      const { name, type } = JSON.parse(String(init.body));
      const account = { id: String(nextId++), attributes: { name, type } };
      accounts.push(account);
      return { data: account };
    }
    if (path === '/v1/transactions')
      return {
        data: { id: 'g1', attributes: { transactions: [{ transaction_journal_id: 'j1' }] } },
      };
    throw new Error(`no handler for ${path}`);
  });
  return { request };
}

describe('account ids', () => {
  it('finds the payee by its exact name, of the right type', async () => {
    const client = fakeFF3([
      { id: '1', attributes: { name: 'Spotify', type: 'asset' } },
      { id: '2', attributes: { name: 'Spotify Family', type: 'expense' } },
      { id: '3', attributes: { name: 'spotify', type: 'expense' } },
    ]);
    const split = await withAccountIds(accountResolver(client as any), {
      type: 'withdrawal',
      source_id: '9',
      destination_name: 'Spotify',
    });
    expect(split).toEqual({ type: 'withdrawal', source_id: '9', destination_id: '3' });
  });

  it("creates a payee FF3 doesn't have yet, once for several splits", async () => {
    const client = fakeFF3([]);
    const resolve = accountResolver(client as any);
    const a = await withAccountIds(resolve, {
      type: 'deposit',
      source_name: 'Employer',
      destination_id: '9',
    });
    const b = await withAccountIds(resolve, {
      type: 'deposit',
      source_name: 'Employer',
      destination_id: '9',
    });
    expect(a.source_id).toBe('100');
    expect(b.source_id).toBe('100');
    const creates = client.request.mock.calls.filter(
      ([path, init]) =>
        path === '/v1/accounts' && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(creates).toHaveLength(1);
    expect(JSON.parse(String((creates[0]![1] as RequestInit).body))).toEqual({
      name: 'Employer',
      type: 'revenue',
    });
  });

  it('never creates an own account', async () => {
    const client = fakeFF3([{ id: '4', attributes: { name: 'Savings', type: 'expense' } }]);
    await expect(
      withAccountIds(accountResolver(client as any), {
        type: 'transfer',
        source_name: 'Savings',
        destination_id: '9',
      }),
    ).rejects.toThrow('no account named "Savings"');
  });

  it("uses the type of the transaction being edited when the change doesn't carry it", async () => {
    const client = fakeFF3([{ id: '5', attributes: { name: 'Lidl', type: 'expense' } }]);
    expect(
      await withAccountIds(
        accountResolver(client as any),
        { destination_name: 'Lidl' },
        'withdrawal',
      ),
    ).toEqual({ destination_id: '5' });
  });

  it("sends a new entry's payee by id", async () => {
    const db = createTestDb();
    await enqueueOperation(db, {
      id: 'op-1',
      kind: 'create_transaction',
      payload: {
        clientId: 'c1',
        splits: [
          {
            type: 'withdrawal',
            source_id: '9',
            destination_name: 'Żabka',
            description: 'x',
          } as any,
        ],
      },
    });
    const client = fakeFF3([{ id: '6', attributes: { name: 'Żabka', type: 'expense' } }]);
    await replayOutbox(db as any, client as any);
    const post = client.request.mock.calls.find(([path]) => path === '/v1/transactions')!;
    const [sent] = JSON.parse(String((post[1] as RequestInit).body)).transactions;
    expect(sent).toMatchObject({ source_id: '9', destination_id: '6' });
    expect(sent).not.toHaveProperty('destination_name');
  });

  it('resolves own account from local SQLite reference_accounts first', async () => {
    const db = createTestDb();
    await db.insert(referenceAccounts).values({
      id: 'acc-wallet',
      name: 'Physical Wallet',
      type: 'asset',
      currencyCode: 'PLN',
      active: true,
      syncedAt: new Date().toISOString(),
    });
    const client = { request: jest.fn() };
    const resolve = accountResolver(client as any, db as any);

    const split = await withAccountIds(resolve, {
      type: 'withdrawal',
      source_name: 'Physical Wallet',
      destination_id: '9',
    });
    expect(split.source_id).toBe('acc-wallet');
    expect(client.request).not.toHaveBeenCalled();
  });
});
