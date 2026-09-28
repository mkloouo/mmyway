// What belongs to one FF3 instance on the device, and the guard around switching away from it.
// Queued operations carry that instance's account, category and transaction ids: replayed
// against another instance they fail, or worse, land on whatever happens to share the id there.
// Cached rows are that instance's too, so they must not mix into the next one's Activity, pickers
// and payee history.
import { eq, inArray, sql } from 'drizzle-orm';
import {
  appSettings, cachedTransactions, inboxItems, outboxOperations,
  referenceAccounts, referenceBudgets, referenceCategories, referenceCurrencies,
} from '../db/schema';
import i18n from '../i18n';
import { INSTANCE_SETTING_KEYS } from '../settings/appSettings';
import type { OutboxDb } from './outbox';

/** Every queued operation, in any status — none of them may outlive the instance it was made for. */
export async function queuedOperationCount(db: OutboxDb): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(outboxOperations);
  return Number(row?.n ?? 0);
}

function normalizeHost(host: string): string {
  return host.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * A sign-in at one of the addresses already stored is the same instance (a new token, say), and
 * keeps its data and queue. Any other address is treated as another instance: the Addresses sheet,
 * not sign-in, is how a second route to the same server is added.
 */
export function isSameInstance(storedHosts: string[], host: string): boolean {
  return storedHosts.map(normalizeHost).includes(normalizeHost(host));
}

/**
 * Removes everything synced from the current instance: reference data, cached transactions, its
 * recurring-transaction reviews and its sync bookkeeping. The user's own drafts, aliases and
 * preferences stay. Callers check queuedOperationCount first — this never touches the outbox.
 */
export async function clearInstanceData(db: OutboxDb): Promise<void> {
  db.transaction((tx) => {
    for (const table of [referenceAccounts, referenceCategories, referenceBudgets, referenceCurrencies, cachedTransactions]) {
      tx.delete(table).run();
    }
    tx.delete(inboxItems).where(eq(inboxItems.kind, 'recurring_review')).run();
    tx.delete(appSettings).where(inArray(appSettings.key, [...INSTANCE_SETTING_KEYS])).run();
  });
}

export function describeQueuedOperations(count: number): string {
  return i18n.t('settings.queuedOperations', { count });
}
