import type { FF3Client } from '../api/ff3/client';
import { fetchAllPages } from '../api/ff3/paginate';

const PAGE_SIZE = 100;

// FF3 paginates every collection endpoint, so a single request truncates silently: a real
// instance has hundreds of expense accounts, and asking for one page of accounts returned
// nothing but payees — no asset account ever reached the device.
export async function fetchAll<T>(client: FF3Client, path: string): Promise<T[]> {
  return fetchAllPages<T>(client, path, { pageSize: PAGE_SIZE });
}

export { pullReferenceData } from './pullReference';
export { pullAccountBalances } from './pullBalances';
export {
  type CachedTransactionInsert,
  searchKeyOf,
  cachedRowFromGroup,
  backfillCachedTransactions,
} from './cachedRow';
export { pullRecentTransactions, pullOlderTransactions } from './pullTransactions';
