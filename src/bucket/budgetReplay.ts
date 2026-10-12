// Sends the queued envelope (budget) create, rename and delete operations from budgetActions.ts to
// FF3. Imports only types from outbox.ts, which dispatches here.
import { and, eq, inArray } from 'drizzle-orm';
import { FF3RequestError, type FF3Client } from '../api/ff3/client';
import { bucketObjects, outboxOperations, referenceBudgets } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';
import { readPayload, writePayload } from '../sync/payloadJson';
import { isUnsent } from '../sync/unsent';
import type {
  CreateBudgetPayload,
  DeleteBudgetPayload,
  UpdateBudgetPayload,
} from './budgetActions';
import type { SetBudgetLimitsPayload } from './replay';

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
    await swapBudgetId(db, payload.clientId, budget.id);
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

/**
 * The create just learned FF3's id for an envelope known so far only by its `mmyway-*` id. Moves
 * everything still pointing at the temporary id — the optimistic row and queued
 * renames, deletes and assignments — over to the real one, or the delete would be dropped as
 * "never synced" and the envelope would survive in FF3.
 */
async function swapBudgetId(db: OutboxDb, clientId: string, serverId: string): Promise<void> {
  await db.delete(referenceBudgets).where(eq(referenceBudgets.id, clientId));
  await db.delete(bucketObjects).where(eq(bucketObjects.ff3Id, clientId)); // the next pull refills
  const ops = await db
    .select()
    .from(outboxOperations)
    .where(
      and(
        inArray(outboxOperations.kind, ['update_budget', 'delete_budget', 'set_budget_limits']),
        isUnsent(),
      ),
    );
  for (const op of ops) {
    let next: object | null = null;
    if (op.kind === 'set_budget_limits') {
      const p = readPayload<SetBudgetLimitsPayload>(op.kind, op.payloadJson);
      if (p.entries.some((e) => e.budgetId === clientId)) {
        next = {
          ...p,
          entries: p.entries.map((e) =>
            e.budgetId === clientId ? { ...e, budgetId: serverId } : e,
          ),
        };
      }
    } else {
      const p = readPayload<UpdateBudgetPayload | DeleteBudgetPayload>(op.kind, op.payloadJson);
      if (p.budgetId === clientId) next = { ...p, budgetId: serverId };
    }
    if (next) {
      await db
        .update(outboxOperations)
        .set({ payloadJson: writePayload(next) })
        .where(eq(outboxOperations.id, op.id));
    }
  }
}
