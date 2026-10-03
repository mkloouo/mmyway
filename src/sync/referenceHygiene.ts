// Two corrections runSync applies right after the reference pull (src/sync/referenceData.ts).
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  outboxOperations,
  referenceAccounts,
  referenceBudgets,
  referenceCategories,
  referenceCurrencies,
} from '../db/schema';
import { setEnvelopeMarker } from '../accounts/envelopeMarker';
import type { AccountEdit } from '../accounts/accountEdit';
import type { OutboxDb, ReorderAccountsPayload, UpdateAccountPayload } from './outbox';
import { getAccountOrder, setAccountOrder } from '../settings/appSettings';
import { readPayload } from './payloadJson';

/**
 * The pull only upserts, so an account, category, budget or currency deleted in FF3 stayed in
 * every picker forever (and a category picked from it was sent back by name, re-creating it).
 * Every row the pull just wrote has syncedAt >= `pullStartedAt`; anything older was not in FF3's
 * answer. A table the pull wrote nothing to is left alone — an empty answer is more likely a
 * server hiccup than the user deleting everything.
 */
export async function pruneReferenceData(db: OutboxDb, pullStartedAt: string): Promise<void> {
  for (const table of [
    referenceAccounts,
    referenceCategories,
    referenceBudgets,
    referenceCurrencies,
  ]) {
    const fresh = await db
      .select({ syncedAt: table.syncedAt })
      .from(table)
      .where(gte(table.syncedAt, pullStartedAt))
      .limit(1);
    if (fresh.length === 0) continue;
    await db.delete(table).where(lt(table.syncedAt, pullStartedAt));
  }
}

/**
 * The pull runs before the outbox replay, so an account edit made on the device (the envelope
 * checkbox, the active switch, the account page) and not yet sent was overwritten by the server's old copy for one
 * sync — the checkbox visibly flipped back. Re-applies every queued account edit, oldest first,
 * on top of what the pull wrote.
 */
export async function reapplyQueuedAccountEdits(db: OutboxDb): Promise<void> {
  const ops = await db
    .select()
    .from(outboxOperations)
    .where(
      and(
        inArray(outboxOperations.kind, ['update_account', 'reorder_accounts']),
        inArray(outboxOperations.status, ['pending', 'failed', 'in_flight']),
      ),
    )
    .orderBy(asc(outboxOperations.sequence));
  const order = await getAccountOrder(db);
  let orderChanged = false;
  for (const op of ops) {
    if (op.kind === 'reorder_accounts') {
      const { orderedIds } = readPayload<ReorderAccountsPayload>(
        'reorder_accounts',
        op.payloadJson,
      );
      orderedIds.forEach((id, index) => {
        order[id] = index + 1;
      });
      orderChanged = true;
      continue;
    }
    const p = readPayload<UpdateAccountPayload>('update_account', op.payloadJson);
    if (p.order !== undefined) {
      order[p.accountId] = p.order;
      orderChanged = true;
    }
    const [account] = await db
      .select()
      .from(referenceAccounts)
      .where(eq(referenceAccounts.id, p.accountId));
    if (!account) continue;
    const patch: AccountEdit & { active?: boolean } = { ...p.edit };
    if (p.active !== undefined) patch.active = p.active;
    if (p.setEnvelopeMarker !== undefined)
      patch.notes = setEnvelopeMarker(account.notes, p.setEnvelopeMarker);
    if (Object.keys(patch).length > 0)
      await db.update(referenceAccounts).set(patch).where(eq(referenceAccounts.id, p.accountId));
  }
  if (orderChanged) await setAccountOrder(db, order);
}
