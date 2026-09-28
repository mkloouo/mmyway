// Account edits the user makes on the device. Each one updates the local reference row right away
// (so every screen reflects it before the next sync) and queues the change for FF3.
import { eq } from 'drizzle-orm';
import { referenceAccounts } from '../db/schema';
import { enqueueOperation, type OutboxDb } from '../sync/outbox';
import { generateId } from '../utils/id';
import { hasEnvelopeMarker, setEnvelopeMarker } from './envelopeMarker';
import { getAccountOrder, setAccountOrder } from '../settings/appSettings';
import type { AccountEdit } from './accountEdit';

export async function setAccountActive(
  db: OutboxDb,
  accountId: string,
  active: boolean,
): Promise<void> {
  await db.update(referenceAccounts).set({ active }).where(eq(referenceAccounts.id, accountId));
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'update_account',
    payload: { accountId, active },
  });
}

export async function setAccountEnvelope(
  db: OutboxDb,
  accountId: string,
  on: boolean,
): Promise<void> {
  const [account] = await db
    .select()
    .from(referenceAccounts)
    .where(eq(referenceAccounts.id, accountId));
  if (!account) throw new Error(`account ${accountId} not found`);
  if (hasEnvelopeMarker(account.notes) === on) return;
  await db
    .update(referenceAccounts)
    .set({ notes: setEnvelopeMarker(account.notes, on) })
    .where(eq(referenceAccounts.id, accountId));
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'update_account',
    payload: { accountId, setEnvelopeMarker: on },
  });
}

/** The account page's Save: patches the local row and queues one FF3 update with the changes. */
export async function updateAccount(
  db: OutboxDb,
  accountId: string,
  edit: AccountEdit,
): Promise<void> {
  if (Object.keys(edit).length === 0) return;
  await db.update(referenceAccounts).set(edit).where(eq(referenceAccounts.id, accountId));
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'update_account',
    payload: { accountId, edit },
  });
}

/**
 * Saves a new order for the user's asset accounts, given in display order: positions 1..n,
 * cached locally at once and sent to FF3 (its `order` attribute) for each account whose
 * position changed.
 */
export async function reorderAccounts(db: OutboxDb, orderedIds: string[]): Promise<void> {
  const current = await getAccountOrder(db);
  const next = { ...current };
  const changed: string[] = [];
  orderedIds.forEach((id, index) => {
    if (current[id] !== index + 1) changed.push(id);
    next[id] = index + 1;
  });
  if (changed.length === 0) return;
  await setAccountOrder(db, next);
  for (const accountId of changed) {
    await enqueueOperation(db, {
      id: generateId(),
      kind: 'update_account',
      payload: { accountId, order: next[accountId] },
    });
  }
}
