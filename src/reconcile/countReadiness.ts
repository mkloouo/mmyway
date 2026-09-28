// Whether the cash count can trust the cached balances it compares against (design §6.9). The
// expected amount is FF3's balance as of the last read, so it is wrong in two cases: writes still
// queued (offline spending FF3 hasn't seen), and writes that reached FF3 after the balances were
// read. Counting in either case shows that spending as drift and books it a second time.
import i18n from '../i18n';
import { getBalancesStale } from '../settings/appSettings';
import { queuedLedgerOpCount, type OutboxDb } from '../sync/outbox';

export type CountBlocker = { reason: 'queued'; count: number } | { reason: 'stale_balances' };

export function countBlocker(queuedLedgerOps: number, balancesStale: boolean): CountBlocker | null {
  if (queuedLedgerOps > 0) return { reason: 'queued', count: queuedLedgerOps };
  if (balancesStale) return { reason: 'stale_balances' };
  return null;
}

/** The same check read straight from the database, for the moment of confirming. */
export async function readCountBlocker(db: OutboxDb): Promise<CountBlocker | null> {
  const [queued, stale] = await Promise.all([queuedLedgerOpCount(db), getBalancesStale(db)]);
  return countBlocker(queued, stale);
}

export function describeCountBlocker(blocker: CountBlocker): string {
  if (blocker.reason === 'queued') return i18n.t('count.blockerQueued', { count: blocker.count });
  return i18n.t('count.blockerStale');
}
