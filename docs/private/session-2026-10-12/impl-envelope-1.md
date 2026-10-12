# Implementation: Envelope (Budget) Create, Rename & Delete - Data/Sync Layer

**Date:** 2026-10-12  
**Chunk:** 1 (Data & Sync Layer + Unit Tests)  
**Commit SHA:** b9c4a96

## Summary

Implemented the data and sync layer for envelope (budget) creation, renaming, and deletion in the mmyway app. All three outbox kinds (`create_budget`, `update_budget`, `delete_budget`) are now integrated, queued, and replayed with proper conflict handling and cascade deletion support.

## Files Modified

### Core Changes
- `src/db/schema.ts` — Added three new outbox kinds to the enum
- `src/sync/payloadJson.ts` — Added zod schemas for all three budget operations
- `src/sync/outboxSubjects.ts` — Added subject blocking cases (`budget:{id}`)
- `src/sync/outbox.ts` — Added type definitions, imports, and replay switch cases
- `src/inbox/queuedChanges.ts` — Added switch cases to describe queued budget operations

### New Files
- `src/bucket/budgetActions.ts` — Enqueue and replay functions
- `src/bucket/budgetActions.test.ts` — Unit tests (16 tests, all passing)

## Exported Functions (for UI chunk)

```typescript
export async function enqueueBudgetCreate(
  db: OutboxDb,
  name: string,
  currencyCode: string,
): Promise<string>  // Returns client ID (mmyway-${uuid})

export async function enqueueBudgetRename(
  db: OutboxDb,
  budgetId: string,
  newName: string,
  expectedUpdatedAt?: string,
): Promise<void>

export async function enqueueBudgetDelete(
  db: OutboxDb,
  budgetId: string,
  name: string,
  expectedUpdatedAt?: string,
): Promise<void>

// Internal (replay only):
export async function replayCreateBudget(...)
export async function replayUpdateBudget(...)
export async function replayDeleteBudget(...)
```

## Key Implementation Details

### Create Budget
- Generates client ID as `mmyway-${uuid}` for offline-first tracking
- POSTs to `/v1/budgets` with `active: true` and `internal_reference: mmyway:{clientId}`
- On 422 duplicate, adopts existing budget by name
- Records `serverId` in payload once FF3 responds

### Update Budget (Rename)
- PUTs to `/v1/budgets/{id}` with new name
- Conflict-checked against `updated_at` (throws error if mismatch)
- Updates local `reference_budgets` cache

### Delete Budget
- **For unsynced budgets** (`mmyway-*` ID):
  - Removes the local row from `reference_budgets` only
  - No FF3 call made
  - Drops any queued `create_budget`/`update_budget` operations for same ID
- **For synced budgets** (real server ID):
  - Deletes from FF3 via `/v1/budgets/{id}`
  - Cascade-cleans `bucketObjects` (removes all `budget_limit` and `budget_spent` rows)
  - Removes from local `reference_budgets` cache

### Subject Blocking
- `create_budget` blocks on subject `budget:{clientId}` until `serverId` recorded
- `update_budget` blocks on subject `budget:{budgetId}`
- `delete_budget` blocks on subject `budget:{budgetId}`
- Prevents race conditions when operations on same envelope are queued offline

### Conflict Handling
- `update_budget` and `delete_budget` compare `expectedUpdatedAt` with server's current `updated_at`
- On mismatch, throws descriptive error (e.g., "Groceries changed in Firefly III since you edited it — open it and rename it again")
- Inbox surfaces this as a conflict card for retry or discard

## Tests (16 total, all passing)

### enqueueBudgetCreate (1 test)
- ✓ Generates mmyway-* ID and queues operation

### enqueueBudgetRename (2 tests)
- ✓ Queues update_budget with budget ID and name
- ✓ Omits expectedUpdatedAt when not provided

### enqueueBudgetDelete (3 tests)
- ✓ Queues delete_budget operation
- ✓ Removes queued create for unsynced budget
- ✓ Removes queued update for unsynced budget

### replayCreateBudget (2 tests)
- ✓ Creates budget and records server ID
- ✓ Adopts existing on 422 duplicate

### replayUpdateBudget (3 tests)
- ✓ Updates budget name
- ✓ Throws conflict on updated_at mismatch
- ✓ Throws error if budget no longer exists

### replayDeleteBudget (5 tests)
- ✓ Deletes unsynced budget locally only (no FF3 call)
- ✓ Deletes synced budget from FF3 and locally
- ✓ Cascade-deletes budget_limit and budget_spent rows
- ✓ Handles already-deleted budget gracefully (404)
- ✓ Throws conflict on updated_at mismatch

## Assumed i18n Keys (for UI chunk)

The UI chunk will need to add these to `src/i18n/locales/en.json`:

```json
{
  "budget": {
    "nameLabel": "Envelope name",
    "namePlaceholder": "e.g. Groceries, Rent",
    "createTitle": "New envelope",
    "createAction": "Create",
    "renameTitle": "Rename '{name}'?",
    "renameAction": "Rename",
    "deleteTitle": "Delete '{name}'?",
    "deleteAction": "Delete",
    "deleteBody": "This cannot be undone. Spending already tracked will remain."
  }
}
```

## Deviations from Spec

None. Implementation follows the spec exactly:
- Three separate outbox kinds (create/update/delete)
- Optimistic local ID handling (mmyway-${uuid})
- Conflict checking on update/delete
- Cascade deletion of budget_limit/budget_spent rows
- Subject blocking on budget:{id}
- Removal of queued ops when deleting unsynced budgets
- Graceful 404 handling for already-deleted budgets

## Test Counts

- **Total Test Suites:** 142 (all passing)
- **Total Tests:** 979 (all passing)
- **New Tests (budgetActions.test.ts):** 16 (all passing)
- **Typecheck:** 0 errors
- **Lint:** 0 errors/warnings

## What's Next (Chunk 2)

Chunk 2 will implement:
- UI screens (`app/(tabs)/budget.tsx`, `app/budget/new.tsx`, `app/budget/[id].tsx`)
- Screen tests
- i18n strings in all locales
- CHANGELOG entry

All data/sync layer functions are ready to call from the UI screens.
