// What belongs to one FF3 instance on the device, and the guard around switching away from it.
// Queued operations carry that instance's account, category and transaction ids: replayed
// against another instance they fail, or worse, land on whatever happens to share the id there.
// Cached rows are that instance's too, so they must not mix into the next one's Activity, pickers
// and payee history.
import { eq, inArray, ne, sql } from 'drizzle-orm';
import {
  aliases,
  appSettings,
  cachedTransactions,
  inboxItems,
  outboxOperations,
  plannedObjects,
  referenceAccounts,
  referenceBudgets,
  referenceCategories,
  referenceCurrencies,
} from '../db/schema';
import { readDraft, writeDraft } from '../inbox/draftJson';
import { withoutInstanceIds } from '../inbox/draft';
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
 * preferences stay, minus the instance's ids: FF3 ids are small per-instance integers, so an old
 * `3` would book to whatever the new instance calls `3`. The names stay and re-resolve there.
 * Callers check queuedOperationCount first — this never touches the outbox, and they wrap the call
 * in withSyncPaused so a running sync can't refill what was just cleared.
 */
export async function clearInstanceData(db: OutboxDb): Promise<void> {
  db.transaction((tx) => {
    for (const table of [
      referenceAccounts,
      referenceCategories,
      referenceBudgets,
      referenceCurrencies,
      cachedTransactions,
      plannedObjects,
    ]) {
      tx.delete(table).run();
    }
    tx.delete(inboxItems).where(eq(inboxItems.kind, 'recurring_review')).run();
    const drafts = tx
      .select({ id: inboxItems.id, draftJson: inboxItems.draftJson })
      .from(inboxItems)
      .where(ne(inboxItems.state, 'synced'))
      .all();
    for (const { id, draftJson } of drafts) {
      let stripped: string;
      try {
        stripped = writeDraft(withoutInstanceIds(readDraft(draftJson)));
      } catch {
        continue; // unreadable already: nothing here that could be resolved against an id
      }
      tx.update(inboxItems).set({ draftJson: stripped }).where(eq(inboxItems.id, id)).run();
    }
    tx.update(aliases).set({ targetId: null }).run();
    tx.delete(appSettings)
      .where(inArray(appSettings.key, [...INSTANCE_SETTING_KEYS]))
      .run();
  });
}

export function describeQueuedOperations(count: number): string {
  return i18n.t('settings.queuedOperations', { count });
}
