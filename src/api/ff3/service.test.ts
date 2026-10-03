import { createTestDb } from '../../db/testDb';
import { referenceAccounts, referenceCategories } from '../../db/schema';
import { FF3RequestError, type FF3Client } from './client';
import { createFF3Service } from './service';

const NOW = new Date().toISOString();

describe('FF3Service accounts.resolve', () => {
  it('resolves directly from local DB when available without calling remote API', async () => {
    const db = createTestDb();
    await db.insert(referenceAccounts).values({
      id: 'acc-1',
      name: 'Main Checking',
      type: 'asset',
      currencyCode: 'EUR',
      active: true,
      syncedAt: new Date().toISOString(),
    });

    const request = jest.fn();
    const service = createFF3Service({ request } as unknown as FF3Client, db as any);

    const id = await service.accounts.resolve('withdrawal', 'source', 'main checking');
    expect(id).toBe('acc-1');
    expect(request).not.toHaveBeenCalled();
  });

  it('searches remote paginated accounts when not in local DB', async () => {
    const db = createTestDb();
    const request = jest.fn().mockResolvedValue({
      data: [{ id: '99', attributes: { name: 'Supermarket', type: 'expense' } }],
    });
    const service = createFF3Service({ request } as unknown as FF3Client, db as any);

    const id = await service.accounts.resolve('withdrawal', 'destination', 'Supermarket');
    expect(id).toBe('99');
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/v1/search/accounts?query=Supermarket'),
    );
  });

  it('adopts existing account when POST returns 422', async () => {
    const db = createTestDb();
    const request = jest.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/v1/search/accounts')) {
        return { data: [] }; // not found on search
      }
      if (path === '/v1/accounts' && init?.method === 'POST') {
        throw new FF3RequestError(422, 'The name has already been taken.');
      }
      if (path.startsWith('/v1/accounts?type=expense')) {
        return {
          data: [{ id: '105', attributes: { name: 'Existing Merchant', type: 'expense' } }],
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });
    const service = createFF3Service({ request } as unknown as FF3Client, db as any);

    const id = await service.accounts.resolve('withdrawal', 'destination', 'Existing Merchant');
    expect(id).toBe('105');
  });
});

describe('FF3Service categories.resolve', () => {
  it('resolves category from local DB first', async () => {
    const db = createTestDb();
    await db.insert(referenceCategories).values({
      id: 'cat-1',
      name: 'Groceries',
      syncedAt: new Date().toISOString(),
    });

    const request = jest.fn();
    const service = createFF3Service({ request } as unknown as FF3Client, db as any);

    const id = await service.categories.resolve('groceries');
    expect(id).toBe('cat-1');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('FF3Service accounts.resolve, probed against FF3 6.7.6', () => {
  // FF3 lets two accounts differ only in case, each with its own id: probing
  // version-6.7.6 returned both "probe case" (id 15) and "Probe Case" (id 16) from one search.
  it('prefers the exactly-named cached account over one differing only in case', async () => {
    const db = createTestDb();
    await db.insert(referenceAccounts).values([
      {
        id: 'acc-lower',
        name: 'lidl',
        type: 'expense',
        currencyCode: 'PLN',
        active: true,
        syncedAt: NOW,
      },
      {
        id: 'acc-exact',
        name: 'Lidl',
        type: 'expense',
        currencyCode: 'PLN',
        active: true,
        syncedAt: NOW,
      },
    ]);
    const request = jest.fn();
    const service = createFF3Service({ request } as unknown as FF3Client, db as any);

    expect(await service.accounts.resolve('withdrawal', 'destination', 'Lidl')).toBe('acc-exact');
    expect(await service.accounts.resolve('withdrawal', 'destination', 'lidl')).toBe('acc-lower');
    expect(request).not.toHaveBeenCalled();
  });

  it('resolves a payee from the local cache, which holds expense accounts too', async () => {
    // pullReferenceData syncs expense and revenue into reference_accounts, so this is the
    // path every saved entry takes, not just an own-account lookup.
    const db = createTestDb();
    await db.insert(referenceAccounts).values({
      id: 'acc-shop',
      name: 'Biedronka',
      type: 'expense',
      currencyCode: 'PLN',
      active: true,
      syncedAt: NOW,
    });
    const request = jest.fn();
    const service = createFF3Service({ request } as unknown as FF3Client, db as any);

    expect(await service.accounts.resolve('withdrawal', 'destination', '  Biedronka ')).toBe(
      'acc-shop',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses to invent an own account when neither the cache nor FF3 has one', async () => {
    const db = createTestDb();
    const request = jest.fn().mockResolvedValue({ data: [] });
    const service = createFF3Service({ request } as unknown as FF3Client, db as any);

    await expect(service.accounts.resolve('transfer', 'source', 'Savings')).rejects.toThrow(
      'no account named "Savings"',
    );
    expect(
      request.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toHaveLength(0);
  });

  it('rethrows the 422 when the account it names cannot be found to adopt', async () => {
    const db = createTestDb();
    const request = jest.fn(async (path: string, init?: RequestInit) => {
      if (path === '/v1/accounts' && init?.method === 'POST')
        // The real message, from the probe; the code keys on the status, not the text.
        throw new FF3RequestError(422, 'This account name is already in use.');
      return { data: [] };
    });
    const service = createFF3Service({ request } as unknown as FF3Client, db as any);

    await expect(
      service.accounts.resolve('withdrawal', 'destination', 'Ghost Shop'),
    ).rejects.toMatchObject({ status: 422, body: 'This account name is already in use.' });
  });
});
