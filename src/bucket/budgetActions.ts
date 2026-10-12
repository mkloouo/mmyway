// Queues the Budget tab's envelope (budget) create, rename and delete operations.
// Like every other write in the app they go through the outbox, so they work offline and reach FF3
// in order with everything else.
import { and, eq } from 'drizzle-orm';
import { FF3RequestError, type FF3Client } from '../api/ff3/client';
import { bucketObjects, outboxOperations, referenceBudgets } from '../db/schema';
import { enqueueOperation, isUnsent, type OutboxDb } from '../sync/outbox';
import { readPayload, writePayload } from '../sync/payloadJson';
import { generateId } from '../utils/id';

export interface CreateBudgetPayload {
  clientId: string; // becomes internal_reference
  name: string;
  currencyCode: string;
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
 * Create a new envelope (budget) and queue the operation.
 * Returns the temporary client-generated ID.
 */
export async function enqueueBudgetCreate(
  db: OutboxDb,
  name: string,
  currencyCode: string,
): Promise<string> {
  const clientId = `mmyway-${generateId()}`;
  const payload: CreateBudgetPayload = { clientId, name, currencyCode };
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
    // Remove any queued create/update for this unsynced budget
    await db
      .delete(outboxOperations)
      .where(and(eq(outboxOperations.kind, 'create_budget'), isUnsent()))
      .run();
    // Also remove update operations for this budget id
    const updateOps = await db
      .select()
      .from(outboxOperations)
      .where(and(eq(outboxOperations.kind, 'update_budget'), isUnsent()));
    for (const op of updateOps) {
      const p = readPayload<UpdateBudgetPayload>(op.kind, op.payloadJson);
      if (p.budgetId === budgetId) {
        await db.delete(outboxOperations).where(eq(outboxOperations.id, op.id));
      }
    }
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

/**
 * Fetch a budget from FF3 to check if it exists and get its current state.
 */
async function fetchBudget(
  client: FF3Client,
  budgetId: string,
): Promise<{ id: string; attributes: Record<string, unknown> } | null> {
  try {
    const response = await client.request<{
      data?: { id?: string | number; attributes?: Record<string, unknown> };
    }>(`/v1/budgets/${budgetId}`);
    if (response?.data?.id != null) {
      return {
        id: String(response.data.id),
        attributes: response.data.attributes ?? {},
      };
    }
    return null;
  } catch (err) {
    if (err instanceof FF3RequestError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Find an existing budget by name.
 */
async function findBudgetByName(
  client: FF3Client,
  name: string,
): Promise<{ id: string; attributes: Record<string, unknown> } | null> {
  try {
    const response = await client.request<{
      data?: { id?: string | number; attributes?: Record<string, unknown> }[];
    }>('/v1/budgets');
    const wanted = name.trim();
    const found = (response?.data ?? []).find(
      (b) => String(b.attributes?.name ?? '').trim() === wanted,
    );
    if (found?.id != null) {
      return {
        id: String(found.id),
        attributes: found.attributes ?? {},
      };
    }
    return null;
  } catch (err) {
    throw err;
  }
}

/**
 * Replay a create_budget operation: POST to /v1/budgets
 * On 422 duplicate name, adopt the existing budget.
 */
export async function replayCreateBudget(
  db: OutboxDb,
  client: FF3Client,
  opId: string,
  payload: CreateBudgetPayload,
): Promise<void> {
  let budget = payload.serverId ? await fetchBudget(client, payload.serverId) : null;

  if (!budget) {
    try {
      const response = await client.request<{
        data?: { id?: string | number; attributes?: Record<string, unknown> };
      }>('/v1/budgets', {
        method: 'POST',
        body: JSON.stringify({
          name: payload.name,
          active: true,
          currency_code: payload.currencyCode,
          internal_reference: `mmyway:${payload.clientId}`,
        }),
      });
      if (response?.data?.id != null) {
        budget = {
          id: String(response.data.id),
          attributes: response.data.attributes ?? {},
        };
      }
    } catch (err) {
      if (err instanceof FF3RequestError && err.status === 422) {
        // Duplicate name: try to adopt existing
        budget = await findBudgetByName(client, payload.name);
        if (!budget) throw err;
      } else {
        throw err;
      }
    }
  }

  if (budget && budget.id !== payload.serverId) {
    // Record the server ID in the payload
    const updated: CreateBudgetPayload = { ...payload, serverId: budget.id };
    await db
      .update(outboxOperations)
      .set({ payloadJson: writePayload(updated) })
      .where(eq(outboxOperations.id, opId));
  }

  // Update reference_budgets with the server ID
  if (budget) {
    await db
      .insert(referenceBudgets)
      .values({
        id: budget.id,
        name: payload.name,
        active: true,
        syncedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: referenceBudgets.id,
        set: {
          name: payload.name,
          active: true,
          syncedAt: new Date().toISOString(),
        },
      });
  }
}

/**
 * Replay an update_budget operation: PUT to /v1/budgets/{id}
 * Checks for conflicts via updated_at.
 */
export async function replayUpdateBudget(
  db: OutboxDb,
  client: FF3Client,
  _opId: string,
  payload: UpdateBudgetPayload,
): Promise<void> {
  // Check for conflict if we have an expected updated_at
  if (payload.expectedUpdatedAt) {
    const current = await fetchBudget(client, payload.budgetId);
    if (!current) throw new Error('the budget no longer exists in Firefly III');
    const serverUpdatedAt =
      typeof current.attributes.updated_at === 'string' ? current.attributes.updated_at : null;
    if (serverUpdatedAt && serverUpdatedAt !== payload.expectedUpdatedAt) {
      throw new Error(
        `${String(current.attributes.name ?? 'This envelope')} changed in Firefly III since you edited it — open it and rename it again`,
      );
    }
  }

  // Send the update
  const response = await client.request<{
    data?: { attributes?: Record<string, unknown> };
  }>(`/v1/budgets/${payload.budgetId}`, {
    method: 'PUT',
    body: JSON.stringify({ name: payload.name }),
  });

  // Update reference_budgets
  if (response?.data?.attributes) {
    await db
      .update(referenceBudgets)
      .set({
        name: payload.name,
        syncedAt: new Date().toISOString(),
      })
      .where(eq(referenceBudgets.id, payload.budgetId));
  }
}

/**
 * Replay a delete_budget operation.
 * If budgetId starts with 'mmyway-', it hasn't synced yet: just remove locally.
 * Otherwise, DELETE from FF3 and cascade-clean bucketObjects.
 */
export async function replayDeleteBudget(
  db: OutboxDb,
  client: FF3Client,
  _opId: string,
  payload: DeleteBudgetPayload,
): Promise<void> {
  const isUnsynced = payload.budgetId.startsWith('mmyway-');

  if (!isUnsynced) {
    // Check for conflict if we have an expected updated_at
    if (payload.expectedUpdatedAt) {
      const current = await fetchBudget(client, payload.budgetId);
      if (current) {
        const serverUpdatedAt =
          typeof current.attributes.updated_at === 'string' ? current.attributes.updated_at : null;
        if (serverUpdatedAt && serverUpdatedAt !== payload.expectedUpdatedAt) {
          throw new Error(
            `${payload.name} changed in Firefly III since you deleted it — open it and delete it again`,
          );
        }
      }
    }

    // DELETE from FF3
    try {
      await client.request(`/v1/budgets/${payload.budgetId}`, {
        method: 'DELETE',
      });
    } catch (err) {
      // Already gone (deleted in FF3's web UI, or an earlier attempt): that's the goal.
      if (!(err instanceof FF3RequestError && err.status === 404)) throw err;
    }
  }

  // Cascade cleanup: remove budget_limit and budget_spent rows from cache
  await db.delete(bucketObjects).where(and(eq(bucketObjects.ff3Id, payload.budgetId)));

  // Remove from reference_budgets
  await db.delete(referenceBudgets).where(eq(referenceBudgets.id, payload.budgetId));
}
