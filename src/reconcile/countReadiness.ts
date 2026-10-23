// Whether the cash count can trust the cached balances it compares against (design §6.9). The
// expected amount is FF3's balance as of the last read, so it is wrong in two cases: writes still
// queued (offline spending FF3 hasn't seen), and writes that reached FF3 after the balances were
// read. Counting in either case shows that spending as drift and books it a second time.
import { eq, inArray } from 'drizzle-orm';
import i18n from '../i18n';
import { appSettings, outboxOperations } from '../db/schema';
import { useDb } from '../providers/DbProvider';
import { useLiveQuery } from '../db/useLiveQuery';
import { BALANCES_STALE_KEY, getBalancesStale } from '../settings/appSettings';
import { LEDGER_KINDS, queuedLedgerOpCount, type OutboxDb } from '../sync/outbox';

export type CountBlocker = { reason: 'queued'; count: number } | { reason: 'stale_balances' };

export function countBlocker(queuedLedgerOps: number, balancesStale: boolean): CountBlocker | null {
  if (queuedLedgerOps > 0) return { reason: 'queued', count: queuedLedgerOps };
  if (balancesStale) return { reason: 'stale_balances' };
  return null;
}

/** React hook that subscribes to ledger outbox and balance staleness. */
export function useCountReadiness() {
  const db = useDb();
  const { data: queuedLedgerOps } = useLiveQuery(
    db
      .select({ id: outboxOperations.id })
      .from(outboxOperations)
      .where(inArray(outboxOperations.kind, [...LEDGER_KINDS])),
  );
  const { data: staleRows } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.key, BALANCES_STALE_KEY)),
  );
  const readinessLoaded = queuedLedgerOps !== undefined && staleRows !== undefined;
  const blocker = readinessLoaded
    ? countBlocker(queuedLedgerOps.length, staleRows[0]?.value === '1')
    : null;
  const canCount = readinessLoaded && !blocker;
  return { readinessLoaded, blocker, canCount };
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
