// Unified Firefly III API Service.
// Encapsulates preprocessing, postprocessing, pagination, local-first resolution,
// and 422 conflict adoption for all Firefly III operations.
import type { FF3Client } from './client';
import { FF3RequestError } from './client';
import { fetchAllPages, type PaginationOptions } from './paginate';
import { referenceAccounts, referenceCategories } from '../../db/schema';
import type { OutboxDb } from '../../sync/outbox';
import type { TransactionRead } from './types';

export type TxType = 'withdrawal' | 'deposit' | 'transfer';
export type End = 'source' | 'destination';

const PAYEE_TYPES = ['expense', 'revenue'];

function payeeTypeOf(type: TxType, end: End): 'expense' | 'revenue' | null {
  if (type === 'withdrawal' && end === 'destination') return 'expense';
  if (type === 'deposit' && end === 'source') return 'revenue';
  return null;
}

type AccountFound = { id: string; attributes: { name: string; type: string } };
type Read<T> = { data: { id: string; attributes: T } };

export class FF3Service {
  constructor(
    public readonly client: FF3Client,
    public readonly db?: OutboxDb,
  ) {}

  /** Universal paginated fetch for collection endpoints. */
  async paginate<T>(path: string, options?: PaginationOptions<T>): Promise<T[]> {
    return fetchAllPages<T>(this.client, path, options);
  }

  readonly accounts = {
    /**
     * Resolves an account name to an ID:
     * 1. Checks local SQLite reference_accounts first (instant, offline-capable).
     * 2. If not found, paginates remote /v1/search/accounts across ALL pages.
     * 3. For payees not in FF3, creates via POST /v1/accounts.
     * 4. If POST returns 422 ("already taken"), re-searches and adopts the ID instead of failing.
     */
    resolve: async (type: TxType, end: End, name: string): Promise<string> => {
      const trimmedName = name.trim();
      const payeeType = payeeTypeOf(type, end);

      // 1. Local-first check in SQLite
      if (this.db) {
        const cached = await this.db.select().from(referenceAccounts);
        const rightType = (a: { type: string }) =>
          payeeType ? a.type === payeeType : !PAYEE_TYPES.includes(a.type);
        // FF3 lets two accounts differ only in case ("Lidl" and "lidl" are both real, with
        // their own ids), so the exact name wins before the case-insensitive fallback does.
        const match =
          cached.find((a) => rightType(a) && a.name === trimmedName) ??
          cached.find((a) => rightType(a) && a.name.toLowerCase() === trimmedName.toLowerCase());
        if (match) return match.id;
      }

      // 2. Paginated search across all pages in FF3
      const query = new URLSearchParams({
        query: trimmedName,
        field: 'name',
        type: payeeType ?? 'all',
      });
      const candidates = await this.paginate<AccountFound>(`/v1/search/accounts?${query}`, {
        stopWhen: (a) =>
          a.attributes.name.toLowerCase() === trimmedName.toLowerCase() &&
          (payeeType ? a.attributes.type === payeeType : !PAYEE_TYPES.includes(a.attributes.type)),
      });
      const match = candidates.find(
        (a) =>
          (a.attributes.name === trimmedName ||
            a.attributes.name.toLowerCase() === trimmedName.toLowerCase()) &&
          (payeeType ? a.attributes.type === payeeType : !PAYEE_TYPES.includes(a.attributes.type)),
      );
      if (match) return String(match.id);

      if (!payeeType) {
        throw new Error(`There is no account named "${trimmedName}" in Firefly III.`);
      }

      // 3. Create missing payee with 422 conflict adoption
      try {
        const created = await this.client.request<{ data: { id: string } }>('/v1/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: trimmedName, type: payeeType }),
        });
        return String(created.data.id);
      } catch (err) {
        if (err instanceof FF3RequestError && err.status === 422) {
          // Exists in FF3: fetch all accounts of that type to adopt its ID
          const existing = await this.paginate<AccountFound>(`/v1/accounts?type=${payeeType}`, {
            stopWhen: (a) => a.attributes.name.toLowerCase() === trimmedName.toLowerCase(),
          });
          const found = existing.find(
            (a) => a.attributes.name.toLowerCase() === trimmedName.toLowerCase(),
          );
          if (found) return String(found.id);
        }
        throw err;
      }
    },
  };

  readonly categories = {
    /**
     * Resolves a category by name, creating it if missing and adopting if 422 occurs.
     */
    resolve: async (name: string): Promise<string> => {
      const trimmed = name.trim();

      if (this.db) {
        const categories = await this.db.select().from(referenceCategories);
        const known =
          categories.find((c) => c.name === trimmed) ??
          categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
        if (known) return known.id;
      }

      try {
        const created = await this.client.request<Read<{ name: string }>>('/v1/categories', {
          method: 'POST',
          body: JSON.stringify({ name: trimmed }),
        });
        return String(created.data.id);
      } catch (err) {
        if (!(err instanceof FF3RequestError && err.status === 422)) throw err;
        const all = await this.paginate<{ id: string; attributes: { name: string } }>(
          '/v1/categories',
          { stopWhen: (c) => c.attributes.name.toLowerCase() === trimmed.toLowerCase() },
        );
        const found = all.find((c) => c.attributes.name.toLowerCase() === trimmed.toLowerCase());
        if (found) return String(found.id);
        throw err;
      }
    },
  };

  readonly ruleGroups = {
    /**
     * Finds an existing rule group by title (paginated) or creates it.
     */
    ensure: async (title: string): Promise<string> => {
      const all = await this.paginate<{ id: string; attributes: { title: string } }>(
        '/v1/rule-groups',
        { stopWhen: (g) => g.attributes.title === title },
      );
      const found = all.find((g) => g.attributes.title === title);
      if (found) return String(found.id);

      const created = await this.client.request<Read<{ title: string }>>('/v1/rule-groups', {
        method: 'POST',
        body: JSON.stringify({ title, active: true }),
      });
      return String(created.data.id);
    },
  };

  readonly transactions = {
    /**
     * Remote search across transactions with multi-page support.
     */
    search: async (query: string, maxPages = 2): Promise<TransactionRead[]> => {
      return this.paginate<TransactionRead>(
        `/v1/search/transactions?query=${encodeURIComponent(query)}`,
        { maxPages, pageSize: 50 },
      );
    },
  };
}

export function createFF3Service(client: FF3Client, db?: OutboxDb): FF3Service {
  return new FF3Service(client, db);
}
