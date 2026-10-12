# Envelope (Budget) Outbox Review – Commit e3df7af

## Critical Bugs

### 1. Delete operation's budgetId never updated after create syncs [CRITICAL]
**File:** src/bucket/budgetActions.ts, lines 301–315 (replayDeleteBudget)  
**Severity:** Data loss  

**Flow:**
1. `enqueueBudgetCreate(db, "Food", "USD")` → returns mmyway-123, queues create_budget with clientId=mmyway-123
2. `enqueueBudgetDelete(db, "mmyway-123", "Food")` → queues delete_budget with budgetId=mmyway-123
3. First sync: create replays, FF3 returns server id 456, replayCreateBudget updates payload to serverId=456
4. Second sync: delete replays with payload.budgetId still "mmyway-123" (never updated!)
5. Delete sees mmyway-123 starts with "mmyway-" → skips FF3 DELETE call
6. Result: FF3 still has budget 456; local row deleted only

**Root cause:** When create operation syncs and gets a serverId, subsequent delete operations referencing the old clientId are never updated. Other operations in the system (planned transactions) update queued payloads during replay via `writePayload()`.

**Fix:** After recording serverId in the create operation's payload (line 232–238), also search for and update any queued delete_budget or update_budget operations that reference the clientId:
```typescript
// After recording serverId:
if (!payload.serverId && budget) {
  // Find and update update/delete ops that reference this clientId
  const relatedOps = await db
    .select()
    .from(outboxOperations)
    .where(
      and(
        inArray(outboxOperations.kind, ['update_budget', 'delete_budget']),
        isUnsent()
      )
    );
  for (const op of relatedOps) {
    if (op.kind === 'update_budget') {
      const p = readPayload<UpdateBudgetPayload>(op.kind, op.payloadJson);
      if (p.budgetId === payload.clientId) {
        await db.update(outboxOperations).set({
          payloadJson: writePayload({ ...p, budgetId: budget.id })
        }).where(eq(outboxOperations.id, op.id));
      }
    } else if (op.kind === 'delete_budget') {
      const p = readPayload<DeleteBudgetPayload>(op.kind, op.payloadJson);
      if (p.budgetId === payload.clientId) {
        await db.update(outboxOperations).set({
          payloadJson: writePayload({ ...p, budgetId: budget.id })
        }).where(eq(outboxOperations.id, op.id));
      }
    }
  }
}
```

---

### 2. enqueueBudgetDelete deletes ALL unsynced creates, not just the target's [CRITICAL]
**File:** src/bucket/budgetActions.ts, lines 84–87  
**Severity:** Data loss  

**Flow:**
1. Create budget A: `enqueueBudgetCreate(db, "Groceries", "USD")` → queues create with clientId=mmyway-123
2. Create budget B: `enqueueBudgetCreate(db, "Dining", "USD")` → queues create with clientId=mmyway-456
3. Delete A: `enqueueBudgetDelete(db, "mmyway-123", "Groceries")`
4. The delete query `where(and(eq(outboxOperations.kind, 'create_budget'), isUnsent()))` matches BOTH creates
5. Result: Budget B's create is orphaned; deleting A also deleted B

**Root cause:** The delete filter only checks kind and sent status, not the budgetId/clientId.

**Fix:** Filter for the specific clientId:
```typescript
if (isUnsynced) {
  // Remove create for THIS budget only
  await db
    .delete(outboxOperations)
    .where(
      and(
        eq(outboxOperations.kind, 'create_budget'),
        isUnsent()
      )
    )
    .run();
  // Then scan creates to find the one with matching clientId
  const creates = await db
    .select()
    .from(outboxOperations)
    .where(and(eq(outboxOperations.kind, 'create_budget'), isUnsent()));
  for (const op of creates) {
    const p = readPayload<CreateBudgetPayload>(op.kind, op.payloadJson);
    if (p.clientId === budgetId) {
      await db.delete(outboxOperations).where(eq(outboxOperations.id, op.id)).run();
      break;
    }
  }
```

Or simpler: Pass clientId explicitly and check it:
```typescript
const creates = await db.select().from(outboxOperations)
  .where(and(eq(outboxOperations.kind, 'create_budget'), isUnsent()));
for (const op of creates) {
  const p = readPayload<CreateBudgetPayload>(op.kind, op.payloadJson);
  if (p.clientId === budgetId) {
    await db.delete(outboxOperations).where(eq(outboxOperations.id, op.id)).run();
  }
}
```

---

## Medium-Severity Findings

### 3. currencyCode sent to FF3 but FF3 budgets have no currency field
**File:** src/bucket/budgetActions.ts, line 185  
**Severity:** Unclear intent  

The code sends `currency_code: payload.currencyCode` to `/v1/budgets` POST, but the comment in the interface says "FF3 budgets have no currency". Verify:
- Does FF3's budget endpoint accept currency_code? If no, this field is silently dropped by FF3 and `currencyCode` serves no purpose.
- If yes, where is it used downstream?

**Fix:** If currencyCode is not actually used by FF3, remove it from the payload and stop capturing it:
```typescript
// Remove currencyCode from CreateBudgetPayload interface
export interface CreateBudgetPayload {
  clientId: string;
  name: string;
  // currencyCode removed
  serverId?: string;
}

// And from enqueueBudgetCreate signature:
export async function enqueueBudgetCreate(
  db: OutboxDb,
  name: string,
  // currencyCode: string, // removed
): Promise<string>
```

---

### 4. No duplicate name check before enqueueBudgetCreate
**File:** src/bucket/budgetActions.ts, line 32–45  
**Severity:** Low confidence / design question  

The code relies on FF3's 422 duplicate-name response and adoptExisting() to handle collisions. But AGENTS.md says "Categories are never hardcoded — always read from… reference_budgets". A pre-flight check against reference_budgets could prevent a queued operation for a name that already exists locally:

```typescript
const existing = await db
  .select()
  .from(referenceBudgets)
  .where(eq(referenceBudgets.name, name));
if (existing.length > 0) {
  throw new Error(`Budget "${name}" already exists`);
}
```

Current behavior (retry 422 → adoptExisting) is safe and handles concurrent FF3 creates, but a local guard would fail faster.

**Fix (optional):** Add pre-flight check or document why local check is skipped.

---

### 5. No test for id swap during delete after create syncs
**File:** src/bucket/budgetActions.test.ts  
**Severity:** Coverage gap  

Tests cover:
- Delete unsynced budget (no FF3 call) ✓
- Delete synced budget (FF3 DELETE sent) ✓

But no test for:
- Create budget, queue delete before sync, replay create (serverId recorded), replay delete (should still DELETE from FF3, not skip)

**Fix:** Add test:
```typescript
it('deletes synced budget from FF3 even if queued before create synced', async () => {
  const clientId = 'mmyway-test123';
  let deleteCalled = false;
  const client = {
    request: async (path: string, init?: any) => {
      if (path === '/v1/budgets' && init?.method === 'POST') {
        return {
          data: {
            id: 'server-456',
            attributes: { name: 'Food', active: true }
          }
        };
      }
      if (path === '/v1/budgets/server-456' && init?.method === 'DELETE') {
        deleteCalled = true;
        return undefined;
      }
      throw new Error(`unexpected: ${path}`);
    }
  };

  // Simulate: create, then delete before create syncs, then both replay
  const createPayload: CreateBudgetPayload = {
    clientId,
    name: 'Food',
    currencyCode: 'USD'
  };
  const deletePayload: DeleteBudgetPayload = {
    budgetId: clientId,
    name: 'Food'
  };

  await replayCreateBudget(db, client as any, 'create-op-id', createPayload);
  await replayDeleteBudget(db, client as any, 'delete-op-id', deletePayload);

  expect(deleteCalled).toBe(true); // DELETE should have been sent, NOT skipped
});
```

---

## Minor Findings

### 6. No verification that 422 "adopt" is the right budget
**File:** src/bucket/budgetActions.ts, lines 202–207  
**Severity:** Low  

When FF3 returns 422 (duplicate name), findBudgetByName() searches all budgets by name. A user with two budgets named "Groceries" in FF3 (if that's somehow possible) could cause adoption of the wrong one.

**Fix:** Name is already unique in FF3's UI, so this is low risk. But add a comment or assertion:
```typescript
// FF3 UI enforces unique budget names, so a name match is unambiguous
const budget = await findBudgetByName(client, payload.name);
if (!budget) throw err; // Name collision but not found; re-throw 422
```

---

### 7. Reference to unused import or test mock pattern [MINOR]
**File:** src/bucket/budgetActions.test.ts  
**Severity:** No impact  

Tests correctly mock fetch and assert behavior. No hollow tests.

---

## Summary

| Severity | Count | Issue |
|----------|-------|-------|
| Critical | 2 | Id swap after create (delete still references clientId), delete blitzes all unsynced creates |
| Medium | 1 | currencyCode field sent but not used |
| Low | 2 | No pre-flight duplicate check, incomplete test coverage |
