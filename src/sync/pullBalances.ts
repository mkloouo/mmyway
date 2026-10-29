import { eq } from 'drizzle-orm';
import type { FF3Client } from '../api/ff3/client';
import type { AccountRead } from '../api/ff3/types';
import { referenceAccounts } from '../db/schema';
import type { OutboxDb } from './outbox';
import { fetchAllPages as fetchAll } from '../api/ff3/paginate';

/**
 * Re-reads the balances of asset accounts already cached — nothing else. The full pull runs
 * before the outbox replay and a push sync has none, so without this the balances stayed at
 * their pre-replay values after spending reached FF3, and the cash count booked that spending
 * again as drift. Accounts not yet cached are left for the next full pull.
 */
export async function pullAccountBalances(db: OutboxDb, client: FF3Client): Promise<void> {
  const accounts = await fetchAll<AccountRead>(client, '/v1/accounts?type=asset');
  db.transaction((tx) => {
    for (const account of accounts) {
      const extra = account.attributes as {
        current_balance?: string;
        current_balance_date?: string;
      };
      tx.update(referenceAccounts)
        .set({
          currentBalance: extra.current_balance ?? null,
          currentBalanceDate: extra.current_balance_date ?? null,
        })
        .where(eq(referenceAccounts.id, account.id))
        .run();
    }
  });
}
