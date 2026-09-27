// Account edits the user makes on the device. Each one updates the local reference row right away
// (so every screen reflects it before the next sync) and queues the change for FF3.
import { eq } from 'drizzle-orm';
import { referenceAccounts } from '../db/schema';
import { enqueueOperation, type OutboxDb } from '../sync/outbox';
import { generateId } from '../utils/id';
import { hasEnvelopeMarker, setEnvelopeMarker } from './envelopeMarker';

export async function setAccountActive(db: OutboxDb, accountId: string, active: boolean): Promise<void> {
  await db.update(referenceAccounts).set({ active }).where(eq(referenceAccounts.id, accountId));
  await enqueueOperation(db, { id: generateId(), kind: 'update_account', payload: { accountId, active } });
}

export async function setAccountEnvelope(db: OutboxDb, accountId: string, on: boolean): Promise<void> {
  const [account] = await db.select().from(referenceAccounts).where(eq(referenceAccounts.id, accountId));
  if (!account) throw new Error(`account ${accountId} not found`);
  if (hasEnvelopeMarker(account.notes) === on) return;
  await db.update(referenceAccounts).set({ notes: setEnvelopeMarker(account.notes, on) }).where(eq(referenceAccounts.id, accountId));
  await enqueueOperation(db, { id: generateId(), kind: 'update_account', payload: { accountId, setEnvelopeMarker: on } });
}
