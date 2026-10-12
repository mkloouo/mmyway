import { createTestDb } from '../db/testDb';
import { outboxOperations, referenceBudgets, bucketObjects } from '../db/schema';
import {
  enqueueBudgetCreate,
  enqueueBudgetRename,
  enqueueBudgetDelete,
  type CreateBudgetPayload,
  type UpdateBudgetPayload,
  type DeleteBudgetPayload,
} from './budgetActions';
import { replayCreateBudget, replayUpdateBudget, replayDeleteBudget } from './budgetReplay';
import { readPayload } from '../sync/payloadJson';
import { FF3RequestError } from '../api/ff3/client';

describe('budgetActions', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  describe('enqueueBudgetCreate', () => {
    it('generates a clientId and queues a create_budget operation', async () => {
      const clientId = await enqueueBudgetCreate(db, 'Groceries');
      expect(clientId).toMatch(/^mmyway-/);

      const ops = db.select().from(outboxOperations).all();
      expect(ops).toHaveLength(1);
      expect(ops[0]!.kind).toBe('create_budget');

      const payload = readPayload<CreateBudgetPayload>(ops[0]!.kind, ops[0]!.payloadJson);
      expect(payload.clientId).toBe(clientId);
      expect(payload.name).toBe('Groceries');
      expect(payload).not.toHaveProperty('currencyCode');
      // Shown on the Budget tab before it syncs
      expect(db.select().from(referenceBudgets).all()).toEqual([
        expect.objectContaining({ id: clientId, name: 'Groceries', active: true }),
      ]);
    });
  });

  describe('enqueueBudgetRename', () => {
    it('queues an update_budget operation', async () => {
      await enqueueBudgetRename(db, 'budget-123', 'Dining Out', '2024-01-01T00:00:00Z');

      const ops = db.select().from(outboxOperations).all();
      expect(ops).toHaveLength(1);
      expect(ops[0]!.kind).toBe('update_budget');

      const payload = readPayload<UpdateBudgetPayload>(ops[0]!.kind, ops[0]!.payloadJson);
      expect(payload.budgetId).toBe('budget-123');
      expect(payload.name).toBe('Dining Out');
      expect(payload.expectedUpdatedAt).toBe('2024-01-01T00:00:00Z');
    });

    it('omits expectedUpdatedAt when not provided', async () => {
      await enqueueBudgetRename(db, 'budget-123', 'Dining Out');

      const ops = db.select().from(outboxOperations).all();
      const payload = readPayload<UpdateBudgetPayload>(ops[0]!.kind, ops[0]!.payloadJson);
      expect(payload.expectedUpdatedAt).toBeUndefined();
    });
  });

  describe('enqueueBudgetDelete', () => {
    it('queues a delete_budget operation', async () => {
      await enqueueBudgetDelete(db, 'budget-123', 'Groceries', '2024-01-01T00:00:00Z');

      const ops = db.select().from(outboxOperations).all();
      expect(ops).toHaveLength(1);
      expect(ops[0]!.kind).toBe('delete_budget');

      const payload = readPayload<DeleteBudgetPayload>(ops[0]!.kind, ops[0]!.payloadJson);
      expect(payload.budgetId).toBe('budget-123');
      expect(payload.name).toBe('Groceries');
      expect(payload.expectedUpdatedAt).toBe('2024-01-01T00:00:00Z');
    });

    it('removes queued create operation for unsynced budget (mmyway-*)', async () => {
      const clientId = await enqueueBudgetCreate(db, 'Groceries');
      expect(db.select().from(outboxOperations).all()).toHaveLength(1);

      await enqueueBudgetDelete(db, clientId, 'Groceries');

      const ops = db.select().from(outboxOperations).all();
      expect(ops).toHaveLength(1);
      expect(ops[0]!.kind).toBe('delete_budget');
    });

    it('removes queued update operations for unsynced budget', async () => {
      const clientId = await enqueueBudgetCreate(db, 'Groceries');
      await enqueueBudgetRename(db, clientId, 'Food');
      expect(db.select().from(outboxOperations).all()).toHaveLength(2);

      await enqueueBudgetDelete(db, clientId, 'Food');

      const ops = db.select().from(outboxOperations).all();
      expect(ops).toHaveLength(1);
      expect(ops[0]!.kind).toBe('delete_budget');
    });
  });

  describe('unsynced envelope, then the create syncs', () => {
    const ff3 = () => {
      const calls: string[] = [];
      let next = 100;
      const client = {
        request: async (path: string, init?: any) => {
          calls.push(`${init?.method ?? 'GET'} ${path}`);
          if (path === '/v1/budgets' && init?.method === 'POST') {
            return { data: { id: String(next++), attributes: JSON.parse(init.body) } };
          }
          if (init?.method === 'DELETE' || init?.method === 'PUT')
            return { data: { attributes: {} } };
          throw new Error(`unexpected request: ${path}`);
        },
      };
      return { client, calls };
    };
    const queued = (kind: string) =>
      db
        .select()
        .from(outboxOperations)
        .all()
        .filter((o) => o.kind === kind);

    it("deleting one unsynced envelope keeps the other envelope's create", async () => {
      const a = await enqueueBudgetCreate(db, 'Groceries');
      const b = await enqueueBudgetCreate(db, 'Dining');

      await enqueueBudgetDelete(db, a, 'Groceries');

      const creates = queued('create_budget');
      expect(creates).toHaveLength(1);
      expect(
        readPayload<CreateBudgetPayload>('create_budget', creates[0]!.payloadJson).clientId,
      ).toBe(b);
      expect(
        db
          .select()
          .from(referenceBudgets)
          .all()
          .map((r) => r.id),
      ).toEqual([b]);
    });

    it('a delete queued behind the create reaches FF3 under the server id', async () => {
      const { client, calls } = ff3();
      const clientId = await enqueueBudgetCreate(db, 'Food');
      // The create is already on its way, so the delete can't just cancel it
      db.update(outboxOperations).set({ status: 'in_flight' }).run();
      await enqueueBudgetDelete(db, clientId, 'Food');

      const create = queued('create_budget')[0]!;
      await replayCreateBudget(
        db,
        client as any,
        create.id,
        readPayload('create_budget', create.payloadJson),
      );

      const del = queued('delete_budget')[0]!;
      const payload = readPayload<DeleteBudgetPayload>('delete_budget', del.payloadJson);
      expect(payload.budgetId).toBe('100');
      await replayDeleteBudget(db, client as any, del.id, payload);

      expect(calls).toContain('DELETE /v1/budgets/100');
      expect(db.select().from(referenceBudgets).all()).toHaveLength(0);
    });

    it('swaps the id in queued renames and assignments and drops the temporary row', async () => {
      const { client } = ff3();
      const clientId = await enqueueBudgetCreate(db, 'Food');
      db.update(outboxOperations).set({ status: 'in_flight' }).run();
      await enqueueBudgetRename(db, clientId, 'Groceries');
      db.insert(outboxOperations)
        .values({
          id: 'limits',
          kind: 'set_budget_limits',
          payloadJson: JSON.stringify({
            v: 1,
            periodStart: '2026-10-01',
            periodEnd: '2026-10-31',
            currencyCode: 'PLN',
            entries: [
              { budgetId: clientId, amount: '50.00' },
              { budgetId: 'other', amount: '10.00' },
            ],
          }),
          status: 'pending',
          attempts: 0,
          createdAt: new Date().toISOString(),
          sequence: 9,
        })
        .run();

      const create = queued('create_budget')[0]!;
      await replayCreateBudget(
        db,
        client as any,
        create.id,
        readPayload('create_budget', create.payloadJson),
      );

      const rename = queued('update_budget')[0]!;
      expect(readPayload<UpdateBudgetPayload>('update_budget', rename.payloadJson).budgetId).toBe(
        '100',
      );
      const limits = readPayload<{ entries: { budgetId: string }[] }>(
        'set_budget_limits',
        queued('set_budget_limits')[0]!.payloadJson,
      );
      expect(limits.entries.map((e) => e.budgetId)).toEqual(['100', 'other']);
      expect(
        db
          .select()
          .from(referenceBudgets)
          .all()
          .map((r) => r.id),
      ).toEqual(['100']);
    });
  });

  describe('replayCreateBudget', () => {
    it('creates a budget in FF3 and records the server ID', async () => {
      const clientId = 'mmyway-test123';
      let createCalled = false;
      const client = {
        request: async (path: string, init?: any) => {
          if (path === '/v1/budgets' && init?.method === 'POST') {
            createCalled = true;
            return {
              data: {
                id: 'server-id-123',
                attributes: { name: 'Groceries', active: true },
              },
            };
          }
          throw new Error(`unexpected request: ${path}`);
        },
      };

      const payload: CreateBudgetPayload = {
        clientId,
        name: 'Groceries',
      };
      const opId = 'op-123';

      db.insert(outboxOperations)
        .values({
          id: opId,
          kind: 'create_budget',
          payloadJson: JSON.stringify(payload),
          status: 'in_flight',
          attempts: 0,
          createdAt: new Date().toISOString(),
          sequence: 1,
        })
        .run();

      await replayCreateBudget(db, client as any, opId, payload);

      expect(createCalled).toBe(true);
      const budgets = db.select().from(referenceBudgets).all();
      expect(budgets).toHaveLength(1);
      expect(budgets[0]!.id).toBe('server-id-123');
      expect(budgets[0]!.name).toBe('Groceries');
    });

    it('adopts existing budget on 422 duplicate', async () => {
      const clientId = 'mmyway-test123';
      const client = {
        request: async (path: string, init?: any) => {
          if (path === '/v1/budgets' && init?.method === 'POST') {
            throw new FF3RequestError(422, 'Duplicate', 'POST /v1/budgets');
          }
          if (path === '/v1/budgets') {
            return {
              data: [
                {
                  id: 'existing-id',
                  attributes: { name: 'Groceries', active: true },
                },
              ],
            };
          }
          throw new Error(`unexpected request: ${path}`);
        },
      };

      const payload: CreateBudgetPayload = {
        clientId,
        name: 'Groceries',
      };
      const opId = 'op-123';

      db.insert(outboxOperations)
        .values({
          id: opId,
          kind: 'create_budget',
          payloadJson: JSON.stringify(payload),
          status: 'in_flight',
          attempts: 0,
          createdAt: new Date().toISOString(),
          sequence: 1,
        })
        .run();

      await replayCreateBudget(db, client as any, opId, payload);

      const budgets = db.select().from(referenceBudgets).all();
      expect(budgets).toHaveLength(1);
      expect(budgets[0]!.id).toBe('existing-id');
    });
  });

  describe('replayUpdateBudget', () => {
    it('updates a budget name', async () => {
      const client = {
        request: async (path: string, init?: any) => {
          if (path === '/v1/budgets/budget-123') {
            return {
              data: {
                attributes: { name: 'Dining Out', updated_at: '2024-01-02T00:00:00Z' },
              },
            };
          }
          throw new Error(`unexpected request: ${path}`);
        },
      };

      db.insert(referenceBudgets)
        .values({
          id: 'budget-123',
          name: 'Groceries',
          active: true,
          syncedAt: new Date().toISOString(),
        })
        .run();

      const payload: UpdateBudgetPayload = {
        budgetId: 'budget-123',
        name: 'Dining Out',
      };

      await replayUpdateBudget(db, client as any, 'op-123', payload);

      const budgets = db.select().from(referenceBudgets).all();
      expect(budgets[0]!.name).toBe('Dining Out');
    });

    it('throws conflict error when updated_at mismatches', async () => {
      const client = {
        request: async (path: string) => {
          if (path === '/v1/budgets/budget-123') {
            return {
              data: {
                id: 'budget-123',
                attributes: {
                  name: 'Groceries',
                  updated_at: '2024-01-02T00:00:00Z',
                },
              },
            };
          }
          throw new Error(`unexpected request: ${path}`);
        },
      };

      const payload: UpdateBudgetPayload = {
        budgetId: 'budget-123',
        name: 'Dining Out',
        expectedUpdatedAt: '2024-01-01T00:00:00Z', // different from server
      };

      await expect(replayUpdateBudget(db, client as any, 'op-123', payload)).rejects.toThrow(
        /changed in Firefly III/,
      );
    });

    it('throws error if budget no longer exists', async () => {
      const client = {
        request: async (path: string) => {
          if (path === '/v1/budgets/budget-123') {
            throw new FF3RequestError(404, 'Not Found', 'GET /v1/budgets/budget-123');
          }
          throw new Error(`unexpected request: ${path}`);
        },
      };

      const payload: UpdateBudgetPayload = {
        budgetId: 'budget-123',
        name: 'Dining Out',
        expectedUpdatedAt: '2024-01-01T00:00:00Z',
      };

      await expect(replayUpdateBudget(db, client as any, 'op-123', payload)).rejects.toThrow(
        /no longer exists/,
      );
    });
  });

  describe('replayDeleteBudget', () => {
    it('deletes unsynced budget locally without FF3 call', async () => {
      const clientId = 'mmyway-test123';
      let ffCalled = false;
      const client = {
        request: async () => {
          ffCalled = true;
          throw new Error('should not call FF3');
        },
      };

      db.insert(referenceBudgets)
        .values({
          id: clientId,
          name: 'Groceries',
          active: true,
          syncedAt: new Date().toISOString(),
        })
        .run();

      const payload: DeleteBudgetPayload = {
        budgetId: clientId,
        name: 'Groceries',
      };

      await replayDeleteBudget(db, client as any, 'op-123', payload);

      expect(ffCalled).toBe(false);
      const budgets = db.select().from(referenceBudgets).all();
      expect(budgets).toHaveLength(0);
    });

    it('deletes synced budget from FF3 and locally', async () => {
      const client = {
        request: async (path: string, init?: any) => {
          if (path === '/v1/budgets/budget-123' && init?.method === 'DELETE') {
            return undefined;
          }
          throw new Error(`unexpected request: ${path}`);
        },
      };

      db.insert(referenceBudgets)
        .values({
          id: 'budget-123',
          name: 'Groceries',
          active: true,
          syncedAt: new Date().toISOString(),
        })
        .run();

      const payload: DeleteBudgetPayload = {
        budgetId: 'budget-123',
        name: 'Groceries',
      };

      await replayDeleteBudget(db, client as any, 'op-123', payload);

      const budgets = db.select().from(referenceBudgets).all();
      expect(budgets).toHaveLength(0);
    });

    it('cascade-deletes budget_limit and budget_spent rows', async () => {
      const client = {
        request: async (path: string, init?: any) => {
          if (path === '/v1/budgets/budget-123' && init?.method === 'DELETE') {
            return undefined;
          }
          throw new Error(`unexpected request: ${path}`);
        },
      };

      db.insert(referenceBudgets)
        .values({
          id: 'budget-123',
          name: 'Groceries',
          active: true,
          syncedAt: new Date().toISOString(),
        })
        .run();

      db.insert(bucketObjects)
        .values({
          key: 'budget_limit:budget-123:2024-01-01',
          kind: 'budget_limit',
          ff3Id: 'budget-123',
          periodStart: '2024-01-01',
          attributesJson: '{}',
          syncedAt: new Date().toISOString(),
        })
        .run();

      db.insert(bucketObjects)
        .values({
          key: 'budget_spent:budget-123:2024-01-01',
          kind: 'budget_spent',
          ff3Id: 'budget-123',
          periodStart: '2024-01-01',
          attributesJson: '{}',
          syncedAt: new Date().toISOString(),
        })
        .run();

      const payload: DeleteBudgetPayload = {
        budgetId: 'budget-123',
        name: 'Groceries',
      };

      await replayDeleteBudget(db, client as any, 'op-123', payload);

      const buckets = db.select().from(bucketObjects).all();
      expect(buckets).toHaveLength(0);
      const budgets = db.select().from(referenceBudgets).all();
      expect(budgets).toHaveLength(0);
    });

    it('handles already-deleted budget gracefully', async () => {
      const client = {
        request: async (path: string) => {
          if (path === '/v1/budgets/budget-123') {
            throw new FF3RequestError(404, 'Not Found', 'DELETE /v1/budgets/budget-123');
          }
          throw new Error(`unexpected request: ${path}`);
        },
      };

      db.insert(referenceBudgets)
        .values({
          id: 'budget-123',
          name: 'Groceries',
          active: true,
          syncedAt: new Date().toISOString(),
        })
        .run();

      const payload: DeleteBudgetPayload = {
        budgetId: 'budget-123',
        name: 'Groceries',
      };

      // Should not throw
      await replayDeleteBudget(db, client as any, 'op-123', payload);

      const budgets = db.select().from(referenceBudgets).all();
      expect(budgets).toHaveLength(0);
    });

    it('throws conflict error when updated_at mismatches', async () => {
      const client = {
        request: async (path: string) => {
          if (path === '/v1/budgets/budget-123') {
            return {
              data: {
                id: 'budget-123',
                attributes: {
                  name: 'Groceries',
                  updated_at: '2024-01-02T00:00:00Z',
                },
              },
            };
          }
          throw new Error(`unexpected request: ${path}`);
        },
      };

      const payload: DeleteBudgetPayload = {
        budgetId: 'budget-123',
        name: 'Groceries',
        expectedUpdatedAt: '2024-01-01T00:00:00Z',
      };

      await expect(replayDeleteBudget(db, client as any, 'op-123', payload)).rejects.toThrow(
        /changed in Firefly III/,
      );
    });
  });
});
