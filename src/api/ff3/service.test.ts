import { createTestDb } from '../../db/testDb';
import { referenceAccounts, referenceCategories } from '../../db/schema';
import { FF3RequestError, type FF3Client } from './client';
import { createFF3Service } from './service';

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
