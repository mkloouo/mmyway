// Queues the Budget tab's envelope (budget) create, rename and delete operations.
// Like every other write in the app they go through the outbox, so they work offline and reach FF3
// in order with everything else.
import { and, eq, inArray } from 'drizzle-orm';
import { outboxOperations, referenceBudgets } from '../db/schema';
import { enqueueOperation, isUnsent, type OutboxDb } from '../sync/outbox';
import { readPayload } from '../sync/payloadJson';
import { generateId } from '../utils/id';

export interface CreateBudgetPayload {
  clientId: string; // becomes internal_reference
  name: string;
  serverId?: string; // recorded at replay time
}

export interface UpdateBudgetPayload {
  budgetId: string;
  name: string;
  expectedUpdatedAt?: string; // conflict check
}

export interface DeleteBudgetPayload {
  budgetId: string; // real server id or mmyway-uuid if not synced
  name: string; // for Inbox display
  expectedUpdatedAt?: string; // conflict check
}

/**
 * Create a new envelope (budget) and queue the operation. The envelope shows on the Budget tab
 * at once under its temporary `mmyway-*` id; the create's replay swaps in FF3's id.
 * Returns the temporary client-generated ID.
 */
export async function enqueueBudgetCreate(db: OutboxDb, name: string): Promise<string> {
  const clientId = `mmyway-${generateId()}`;
  const payload: CreateBudgetPayload = { clientId, name };
  await db
    .insert(referenceBudgets)
    .values({ id: clientId, name, active: true, syncedAt: new Date().toISOString() });
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'create_budget',
    payload,
  });
  return clientId;
}

/**
 * Rename an envelope (budget) and queue the operation.
 */
export async function enqueueBudgetRename(
  db: OutboxDb,
  budgetId: string,
  newName: string,
  expectedUpdatedAt?: string,
): Promise<void> {
  const payload: UpdateBudgetPayload = {
    budgetId,
    name: newName,
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
  };
  await db.update(referenceBudgets).set({ name: newName }).where(eq(referenceBudgets.id, budgetId));
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'update_budget',
    payload,
  });
}

/**
 * Delete an envelope (budget) and queue the operation.
 * If the budget hasn't synced yet (clientId is mmyway-*), also removes any queued
 * create or update operations for it.
 */
export async function enqueueBudgetDelete(
  db: OutboxDb,
  budgetId: string,
  name: string,
  expectedUpdatedAt?: string,
): Promise<void> {
  const isUnsynced = budgetId.startsWith('mmyway-');
  if (isUnsynced) {
    // Drop this envelope's own queued create and renames — and only its own.
    const ops = await db
      .select()
      .from(outboxOperations)
      .where(and(inArray(outboxOperations.kind, ['create_budget', 'update_budget']), isUnsent()));
    for (const op of ops) {
      const id =
        op.kind === 'create_budget'
          ? readPayload<CreateBudgetPayload>(op.kind, op.payloadJson).clientId
          : readPayload<UpdateBudgetPayload>(op.kind, op.payloadJson).budgetId;
      if (id === budgetId) {
        await db.delete(outboxOperations).where(eq(outboxOperations.id, op.id));
      }
    }
    await db.delete(referenceBudgets).where(eq(referenceBudgets.id, budgetId));
  }

  const payload: DeleteBudgetPayload = {
    budgetId,
    name,
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
  };
  await enqueueOperation(db, {
    id: generateId(),
    kind: 'delete_budget',
    payload,
  });
}
