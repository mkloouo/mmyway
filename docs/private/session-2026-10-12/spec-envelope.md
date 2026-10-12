# Implementation Spec: Envelope (Budget) Creation, Renaming & Deletion

**Date:** 2026-10-12  
**Status:** Ready for Implementation  
**Feature:** Create, rename, and delete envelopes from Budget tab and detail screen

---

## Overview

The Budget tab currently displays envelopes (Firefly III budgets) but cannot create, rename, or delete them—users must use FF3's web UI. This spec enables full envelope lifecycle:

1. **Create**: New envelope dialog on Budget tab, queued as `create_budget` outbox kind
2. **Rename**: Rename button on envelope detail screen (`app/budget/[id].tsx`), queued as `update_budget` kind
3. **Delete**: Delete button on envelope detail screen (destructive), queued as `delete_budget` kind

All operations go through the outbox for offline queueing, confirmation (mandatory rule), and replay with conflict detection. Deletion handles cascading cleanup of cached limits and local removal if create hasn't synced yet.

---

## Design Decisions

### Outbox Kinds (Three Separate Kinds)

Split into `create_budget` (create), `update_budget` (rename), and `delete_budget` (delete). Rationale:
- Follows existing pattern (create/update/delete transaction, save/delete planned)
- Allows distinct replay logic: create handles 422 duplicates; update checks `updated_at`; delete removes cache and local rows
- Simpler than union type in schema

**Append order** (never reorder existing kinds):
```
'set_budget_limits',
'set_piggy_amount',
'create_budget',      // NEW
'update_budget',      // NEW
'delete_budget',      // NEW
```

### Optimistic Local ID Handling

**For creates:** Use a client-generated temporary ID (`mmyway-${uuid}`) until FF3 responds. The ID appears in:
- `reference_budgets` table as `id` (optimistic)
- `create_budget` payload as `clientId` (for duplicate detection)
- Payload records `serverId` once FF3 responds

On retry after a lost answer:
1. Replay checks FF3 for a budget named `{name}` (active=true assumed)
2. If found, adopt the ID and update payload with `serverId`
3. Otherwise, POST again

**For deletes:** If the create hasn't synced yet (ID is still `mmyway-${uuid}`), just remove from `reference_budgets` and `bucketObjects` locally—no FF3 DELETE call needed. If synced (real server ID), DELETE from FF3 and then remove locally.

### Confirm Step (Mandatory Rule)

- **Create**: `confirmAction()` — "Create envelope?" + "Create"
- **Rename**: `confirmAction()` — "Rename to '{newName}'?" + "Rename"
- **Delete**: `confirmDestructive()` — "Delete '{name}'?" (red button) + "Delete" — warns data is permanent

No confirmation → operation not queued.

### Subject Blocking

Add `budget:{id}` subject to all three kinds. Operations on the same budget queue sequentially, preventing races (e.g., create then delete same envelope offline).

### Cascade Deletion of Cached Limits

When a budget is deleted, clean up locally:
1. Remove all rows from `bucketObjects` where `kind='budget_limit'` and `ff3Id` matches the deleted budget
2. Remove any `budget_spent` rows for the same budget
3. Remove from `reference_budgets`

No separate outbox operation needed; cascade happens on replay success.

---

## Files to Change / Create

### 1. Data & Sync Layer

#### `src/db/schema.ts`
- **Change**: Add `'create_budget'`, `'update_budget'`, `'delete_budget'` to `outboxOperations.kind` enum (line ~117)

**Code snippet:**
```typescript
kind: text('kind', {
  enum: [
    // ... existing kinds ...
    'set_budget_limits',
    'set_piggy_amount',
    'create_budget',    // NEW
    'update_budget',    // NEW
    'delete_budget',    // NEW
  ],
}).notNull(),
```

#### `src/sync/payloadJson.ts`
- **Change**: Add schemas for all three kinds (after `set_piggy_amount` schema, ~line 137)

**Code snippet:**
```typescript
create_budget: z.looseObject({
  v: version,
  clientId: z.string(), // duplicate detection; becomes internal_reference
  name: z.string(),
  currencyCode: z.string(),
  serverId: z.string().optional(), // recorded after FF3 answers
}),
update_budget: z.looseObject({
  v: version,
  budgetId: z.string(), // the FF3 budget id
  name: z.string(),
  expectedUpdatedAt: z.string().optional(), // conflict check
}),
delete_budget: z.looseObject({
  v: version,
  budgetId: z.string(), // the FF3 budget id (or mmyway-uuid if create didn't sync)
  name: z.string(), // for display in Inbox
  expectedUpdatedAt: z.string().optional(), // conflict check
}),
```

#### `src/sync/outboxSubjects.ts`
- **Change**: Add cases for all three kinds to `subjectsOf()` (after `set_piggy_amount` case, ~line 72)

**Code snippet:**
```typescript
case 'create_budget':
  add('budget', p.clientId); // until serverId is recorded
  break;
case 'update_budget':
  add('budget', p.budgetId);
  break;
case 'delete_budget':
  add('budget', p.budgetId);
  break;
```

#### `src/sync/outbox.ts`
- **Change 1**: Add types and export to OutboxKind union (line ~53)
- **Change 2**: Add `NewOutboxOperation.payload` union members (line ~150)
- **Change 3**: Add replay cases in the switch (after `set_piggy_amount` case)

**Code snippet (types):**
```typescript
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

export type OutboxKind =
  | 'create_transaction'
  // ... existing ...
  | 'set_budget_limits'
  | 'set_piggy_amount'
  | 'create_budget'   // NEW
  | 'update_budget'   // NEW
  | 'delete_budget';  // NEW

export interface NewOutboxOperation {
  // ...
  payload:
    | CreateTransactionPayload
    // ... existing ...
    | SetBudgetLimitsPayload
    | SetPiggyAmountPayload
    | CreateBudgetPayload   // NEW
    | UpdateBudgetPayload   // NEW
    | DeleteBudgetPayload;  // NEW
}
```

**Code snippet (import replay functions):**
```typescript
import {
  replayCreateBudget,
  replayUpdateBudget,
  replayDeleteBudget,
  type CreateBudgetPayload,
  type UpdateBudgetPayload,
  type DeleteBudgetPayload,
} from '../bucket/budgetActions';
```

**Code snippet (replay switch):**
```typescript
if (row.kind === 'create_budget') {
  const p = payload as CreateBudgetPayload;
  await replayCreateBudget(db, client, opId, p);
} else if (row.kind === 'update_budget') {
  const p = payload as UpdateBudgetPayload;
  await replayUpdateBudget(db, client, opId, p);
} else if (row.kind === 'delete_budget') {
  const p = payload as DeleteBudgetPayload;
  await replayDeleteBudget(db, client, opId, p);
}
```

#### `src/bucket/budgetActions.ts` (NEW FILE)
Create this file with action queuing functions and replay logic.

**Functions:**
```typescript
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

export async function enqueueBudgetDelete(
  db: OutboxDb,
  budgetId: string,
  name: string,
  expectedUpdatedAt?: string,
): Promise<void> {
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

export async function replayCreateBudget(
  db: OutboxDb,
  client: FF3Client,
  opId: string,
  payload: CreateBudgetPayload,
): Promise<void> {
  // POST to /v1/budgets with { name, active: true, currency_code }
  // If 422 (duplicate name) or existing, adopt; record serverId in payload
  // Update reference_budgets with serverId replacing clientId
  // Retry: update payload with serverId, retry on 5xx/timeout
}

export async function replayUpdateBudget(
  db: OutboxDb,
  client: FF3Client,
  opId: string,
  payload: UpdateBudgetPayload,
): Promise<void> {
  // Check current budget's updated_at; if mismatch, conflict
  // PUT to /v1/budgets/{id} with { name }
  // On success, update reference_budgets and bucket_objects
}

export async function replayDeleteBudget(
  db: OutboxDb,
  client: FF3Client,
  opId: string,
  payload: DeleteBudgetPayload,
): Promise<void> {
  // If budgetId starts with 'mmyway-', it hasn't synced yet:
  //   - Remove from reference_budgets (no FF3 call needed)
  //   - Cascade: remove budget_limit and budget_spent rows from bucketObjects
  // Else:
  //   - Check current budget's updated_at; if mismatch, conflict
  //   - DELETE /v1/budgets/{id}
  //   - On success, remove from reference_budgets and cascade-clean bucketObjects
}
```

---

### 2. UI & Screens

#### `app/(tabs)/budget.tsx`
- **Change**: Add button to create new envelope (in AppBar or before list)

**Code snippet:**
```typescript
import { Plus } from 'react-native-heroicons/outline';

<AppBar
  title={tr('budget.title')}
  right={
    <Button
      onPress={() => navigateOnce('budget-new')}
      icon={Plus}
    />
  }
/>
```

#### `app/budget/new.tsx` (NEW FILE)
Modal screen to create envelope. Uses TextField for name.

**Structure:**
```typescript
export default function NewEnvelopeScreen() {
  const [name, setName] = useState('');
  const db = useDb();
  const act = useAction();
  const { t: tr } = useTranslation();
  const t = useTheme();
  const currencies = useCurrencies();
  const defaultCurrency = currencies.find((c) => c.isDefault);

  const create = act(tr('budget.createAction'), async () => {
    const ok = await confirmAction(
      tr('budget.createTitle'),
      tr('budget.createAction'),
    );
    if (!ok) return;
    const clientId = await enqueueBudgetCreate(
      db,
      name,
      defaultCurrency?.code ?? 'EUR',
    );
    // Update reference_budgets with optimistic row
    router.back();
  });

  return (
    <Screen bottom>
      <AppBar
        title={tr('budget.createTitle')}
        left={<CloseButton onPress={() => router.back()} />}
      />
      <TextField
        label={tr('budget.nameLabel')}
        value={name}
        onChangeText={setName}
        placeholder={tr('budget.namePlaceholder')}
      />
      <Button onPress={create} disabled={!name.trim()}>
        {tr('budget.createAction')}
      </Button>
    </Screen>
  );
}
```

#### `app/budget/[id].tsx`
- **Change 1**: Add "Rename" button and confirmation sheet
- **Change 2**: Add "Delete" button with destructive confirmation + navigation back to Budget tab on success

**Code snippet (rename):**
```typescript
const [renaming, setRenaming] = useState(false);
const [newName, setNewName] = useState(envelope?.name ?? '');

const rename = act(tr('budget.renameAction'), async () => {
  const ok = await confirmAction(
    tr('budget.renameTitle', { name: newName }),
    tr('budget.renameAction'),
  );
  if (!ok) return;
  await enqueueBudgetRename(
    db,
    envelope.budgetId,
    newName,
    envelope.updatedAt,
  );
  setRenaming(false);
});
```

**Code snippet (delete):**
```typescript
const delete_ = act(tr('budget.deleteAction'), async () => {
  const ok = await confirmDestructive(
    tr('budget.deleteTitle', { name: envelope.name }),
    tr('budget.deleteAction'),
    tr('budget.deleteBody'),
  );
  if (!ok) return;
  await enqueueBudgetDelete(
    db,
    envelope.budgetId,
    envelope.name,
    envelope.updatedAt,
  );
  router.back(); // Go back to Budget tab
});
```

---

### 3. i18n Strings

#### `src/i18n/locales/en.json`
Add under `"budget"` object (append, do not reorder existing keys):

```json
{
  "budget": {
    // ... existing keys ...
    "nameLabel": "Envelope name",
    "namePlaceholder": "e.g. Groceries, Rent",
    "createTitle": "New envelope",
    "createAction": "Create",
    "renameTitle": "Rename '{name}'?",
    "renameAction": "Rename",
    "deleteTitle": "Delete '{name}'?",
    "deleteAction": "Delete",
    "deleteBody": "This cannot be undone. Spending already tracked will remain.",
  }
}
```

#### All Other Locale Files
For each locale in `src/i18n/locales/` (e.g. `uk-UA.json`):
- Add empty strings for all new keys

**Example for `uk-UA.json`:**
```json
{
  "budget": {
    // ... existing keys ...
    "nameLabel": "",
    "namePlaceholder": "",
    "createTitle": "",
    "createAction": "",
    "renameTitle": "",
    "renameAction": "",
    "deleteTitle": "",
    "deleteAction": "",
    "deleteBody": "",
  }
}
```

---

### 4. Tests

#### `src/bucket/budgetActions.test.ts` (NEW FILE)
Unit tests for all enqueue and replay functions.

**Test cases:**
- ✓ enqueueBudgetCreate: name queued, clientId generated
- ✓ enqueueBudgetRename: budgetId + name queued
- ✓ enqueueBudgetDelete: budgetId + name queued
- ✓ replayCreateBudget: POST to /v1/budgets, serverId recorded, reference_budgets updated
- ✓ replayCreateBudget: 422 duplicate, adopt existing, update payload
- ✓ replayUpdateBudget: PUT to /v1/budgets/{id}, conflict check (updated_at mismatch)
- ✓ replayUpdateBudget: success, reference_budgets updated
- ✓ replayDeleteBudget: clientId (not synced), no FF3 call, local removal only
- ✓ replayDeleteBudget: server id, DELETE to /v1/budgets/{id}, cascade-clean bucketObjects
- ✓ replayDeleteBudget: conflict (updated_at mismatch), fail with alert

#### `src/__screens__/budget-new.test.tsx` (NEW FILE)
Screen test for creating envelope.

**Test flow:**
```typescript
describe('Budget → New Envelope screen', () => {
  it('renders with empty name, create button disabled', () => {
    render(<NewEnvelopeScreen />);
    expect(screen.getByPlaceholderText('e.g. Groceries, Rent')).toBeVisible();
    expect(screen.getByText('Create')).toBeDisabled();
  });

  it('types name, taps create, shows confirmation', async () => {
    render(<NewEnvelopeScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Groceries, Rent'), 'Dining Out');
    expect(screen.getByText('Create')).toBeEnabled();
    fireEvent.press(screen.getByText('Create'));
    // Confirmation alert shown
  });

  it('confirm creates envelope, queues outbox, closes sheet', async () => {
    // Confirm the alert, verify outbox has create_budget operation
  });
});
```

#### `src/__screens__/budget-detail.test.tsx` (UPDATE EXISTING)
Add tests for rename and delete on budget detail screen.

**Test cases:**
- ✓ Envelope detail renders "Rename" and "Delete" buttons
- ✓ Tap rename, sheet opens, confirm queues update_budget outbox
- ✓ Tap delete, confirmation shown with destructive button, confirm queues delete_budget outbox
- ✓ Delete closes screen and navigates back to Budget tab
- ✓ Conflict shown if updated_at mismatch on either operation

---

### 5. CHANGELOG

#### `CHANGELOG.md`
Add under `[Unreleased]` in the **Budget** section:

```markdown
### Budget
- Create new envelopes directly from the Budget tab (previously required Firefly III's web UI)
- Rename existing envelopes from the envelope detail screen
- Delete envelopes (spending already tracked will remain in Firefly III)
```

---

### 6. Maestro Flow

#### `.maestro/flows/budget/B1-create-rename-delete.yaml` (NEW FILE)

```yaml
appId: ${APP_ID}
name: 'B1 · Create, rename, and delete envelope'
tags:
  - smoke
---
- runFlow: ../../subflows/ready.yaml

# Navigate to Budget tab
- tapOn: 'Budget, tab, 4 of 5'

# CREATE: Tap create button
- tapOn:
    label: '.*[Cc]reate.*'

# Type envelope name
- tapOn:
    label: 'Envelope name'
- inputText: 'B1 Test ${RUN_ID}'

# Tap Create
- tapOn: 'Create'

# Confirm dialog
- runFlow:
    when:
      visible: 'Create.*envelope.*\\?'
    commands:
      - tapOn: 'Create'

# Wait for sync
- runFlow: ../../subflows/wait-sent.yaml

# Verify in FF3
- runScript:
    file: ../../scripts/ff3.js
    env:
      ACTION: expectBudget
      NAME: 'B1 Test ${RUN_ID}'
      EXPECT_ACTIVE: 'true'

# RENAME: Tap the newly created envelope
- tapOn:
    label: 'B1 Test ${RUN_ID}'

# Tap rename button
- tapOn:
    label: 'Rename'

# Edit name
- inputText: 'B1 Renamed ${RUN_ID}'

# Confirm rename
- tapOn: 'Rename'
- runFlow:
    when:
      visible: 'Rename to.*\\?'
    commands:
      - tapOn: 'Rename'

# Wait for sync
- runFlow: ../../subflows/wait-sent.yaml

# Verify rename in FF3
- runScript:
    file: ../../scripts/ff3.js
    env:
      ACTION: expectBudget
      NAME: 'B1 Renamed ${RUN_ID}'
      EXPECT_ACTIVE: 'true'

# DELETE: Tap delete button
- tapOn:
    label: 'Delete'

# Confirm destructive delete
- runFlow:
    when:
      visible: 'Delete.*\\?'
    commands:
      - tapOn: 'Delete'

# Wait for sync
- runFlow: ../../subflows/wait-sent.yaml

# Verify deleted in FF3 (should not exist or be inactive)
- runScript:
    file: ../../scripts/ff3.js
    env:
      ACTION: expectBudgetDeleted
      NAME: 'B1 Renamed ${RUN_ID}'
```

Register in `scripts/e2e.mjs` FLOWS:

```javascript
{
  id: 'B1',
  tier: 'smoke',
  title: 'Create, rename, and delete envelope',
  steps: ['budget/B1-create-rename-delete.yaml'],
  areas: [
    'app/(tabs)/budget.tsx',
    'app/budget/[id].tsx',
    'app/budget/new.tsx',
    'src/bucket/budgetActions.ts',
  ],
},
```

---

## Implementation Chunks

### Chunk 1: Data & Sync Layer + Unit Tests (~25k tokens)
**Goal**: Outbox enqueue and replay logic for all three kinds, database schema, payload serialization.

**Files to read:**
- `src/db/schema.ts` (full)
- `src/sync/payloadJson.ts` (full)
- `src/sync/outbox.ts` (full, esp. replaySetBudgetLimits, replayDeletePlanned)
- `src/bucket/replay.ts` (full, for pattern)
- `src/bucket/actions.ts` (full, for enqueueOperation pattern)
- `src/sync/outboxSubjects.ts` (full)
- `src/bucket/objects.ts` (read patterns)
- `src/planned/replay.ts` (for delete pattern)

**Files to touch:**
- `src/db/schema.ts` — add kinds to enum
- `src/sync/payloadJson.ts` — add schemas for all three
- `src/sync/outboxSubjects.ts` — add subject cases for all three
- `src/sync/outbox.ts` — add types, import, replay switch for all three
- `src/bucket/budgetActions.ts` — create (enqueue + replay functions for all three)

**Deliverables:**
- ✓ Outbox kinds registered, payload schemas validated
- ✓ Subject blocking for budget:id (all three kinds)
- ✓ Replay logic: create with 422 handling, update with conflict check, delete with local-only vs. FF3 cases
- ✓ Cascade deletion of budget_limit and budget_spent rows
- ✓ Unit tests pass (jest)
- ✓ `npm run check` passes

---

### Chunk 2: UI Screens + Screen Tests + i18n + CHANGELOG (~30k tokens)
**Goal**: Budget tab button, new envelope sheet, detail rename + delete UI, strings, tests.

**Files to read:**
- `app/(tabs)/budget.tsx` (full)
- `app/budget/[id].tsx` (full)
- `src/ui/components.tsx` (TextField, Button patterns)
- `src/ui/confirm.ts` (confirmAction, confirmDestructive)
- `src/__screens__/budget.test.tsx` (test pattern)
- `src/planned/replay.ts` (for replayDeletePlanned pattern on cascading cleanup)

**Files to touch:**
- `app/(tabs)/budget.tsx` — add create button
- `app/budget/new.tsx` — create (new file)
- `app/budget/[id].tsx` — add rename + delete UI
- `src/i18n/locales/en.json` — add keys for all three
- `src/i18n/locales/*.json` — add empty keys for all three
- `src/__screens__/budget-new.test.tsx` — create (test file)
- `src/__screens__/budget-detail.test.tsx` — update (add rename + delete tests)
- `CHANGELOG.md` — add entry

**Deliverables:**
- ✓ Create button on Budget tab, opens new envelope sheet
- ✓ Envelope detail has rename button and delete button (destructive styling)
- ✓ Confirmation before queue (confirmAction for create/rename, confirmDestructive for delete)
- ✓ Delete button navigates back to Budget tab after confirm
- ✓ i18n keys in all locale files
- ✓ Screen tests pass
- ✓ `npm run typecheck` + `npm run lint` pass

---

### Chunk 3: Maestro Flow + Integration Test (~12k tokens)
**Goal**: E2E flow covering create → rename → delete, FF3 validation, registration.

**Files to read:**
- `.maestro/flows/` (existing flow examples)
- `.maestro/subflows/` (ready, wait-sent, sync patterns)
- `scripts/ff3.js` (expectBudget action, add expectBudgetDeleted if missing)
- `scripts/e2e.mjs` (FLOWS array)

**Files to touch:**
- `.maestro/flows/budget/B1-create-rename-delete.yaml` — create
- `scripts/ff3.js` — add expectBudget and expectBudgetDeleted actions if missing
- `scripts/e2e.mjs` — register B1

**Deliverables:**
- ✓ Flow creates envelope, verifies in FF3, renames, re-verifies, deletes, re-verifies
- ✓ Maestro syntax checked (`maestro check-syntax`)
- ✓ Registered in FLOWS with areas
- ✓ `npm run e2e -- B1` passes (device test)

---

## Edge Cases & Specifications

### Delete a Budget Whose Create Hasn't Synced Yet

**Scenario:** User creates envelope (clientId = `mmyway-abc123`), immediately deletes before sync.

**Behavior:**
1. Delete operation queued with budgetId = `mmyway-abc123`
2. Replay checks: budgetId starts with `mmyway-` → local-only removal
3. Remove from `reference_budgets` and `bucketObjects` locally
4. **No FF3 call made** (nothing to delete there)
5. Mark operation as done

**Test:** enqueueBudgetCreate → enqueueBudgetDelete (same offline session) → sync → verify both gone locally, no FF3 errors

### Delete a Budget With Existing Limits

**Scenario:** User deletes a budget that has budget_limit rows cached in bucketObjects.

**Behavior:**
1. Replay DELETE /v1/budgets/{id} to FF3
2. On success, cascade-clean: remove all bucketObjects rows with kind='budget_limit' and ff3Id matching
3. Also remove any budget_spent rows for the same budget
4. Remove from reference_budgets
5. Inbox shows operation as done

**Test:** replayDeleteBudget with budget_limit rows → verify cascade cleanup

### Update/Delete With Conflict (updated_at Mismatch)

**Scenario:** User renames/deletes a budget, FF3's copy was changed in web UI meanwhile.

**Behavior:**
1. Fetch current budget from /v1/budgets/{id}
2. Compare cached updated_at vs. current updated_at → conflict
3. Don't send the change; fail the operation with conflict message
4. Inbox shows conflict; user can "Retry now" (updates cached and retries) or "Discard"

**Test:** replayUpdateBudget with conflict → verify error message + conflict in Inbox

### Pending Delete + New Queued Operations

**Scenario:** User queues delete, then tries to rename the same budget.

**Behavior:**
- Delete is `subject: budget:abc123`
- Rename is `subject: budget:abc123`
- Rename waits behind delete via subject blocking
- Delete lands first, removes budget; rename then fails (budget no longer exists)
- Inbox shows rename as failed; user sees "budget no longer exists"

**Test:** enqueueBudgetDelete → enqueueBudgetRename (same offline) → sync → verify delete succeeds, rename fails gracefully

---

## Notes & Flags

### Docs Research Findings

- **Create/rename/delete are not mentioned in planning docs** (`ynab-bucket-budgeting*.md`) because they were deferred to v1.1 (gaps.md §5)
- **Budgets have an `active` boolean** in FF3, usable for soft-deletion, but DELETE endpoint is the standard pattern
- **Reference docs only cover limit management** (budget_limit POST/PUT/DELETE), not budget lifecycle
- **No budget groups** like rule groups — can't use "adoptExisting by group"; check active=true instead

### Decision: Delete vs. Archive

⚠ **User decision**: Should "delete" actually DELETE from FF3 (`DELETE /v1/budgets/{id}`), or deactivate (PUT with `active: false`)?
- **Current spec**: Hard delete (DELETE endpoint)
- **Alternative**: Soft-delete via deactivate (`active: false`), then hide inactive from Budget tab UI
- **Rationale for delete**: Cleaner UX; user can see data was removed; spending history remains in Firefly III under transactions

### Decision: Cascade Cleanup

✓ **Confirmed**: On delete, cascade-remove budget_limit and budget_spent rows from cache. Rationale:
- Budget no longer exists in FF3, so its limits are orphaned
- Prevents stale data when budget is recreated with same name
- Matches planned/delete pattern (cleans up bill/rule/recurrence)

### Tests: Missing Actions in ff3.js?

⚠ Check if `scripts/ff3.js` has:
- `expectBudget` action (name, active status)
- `expectBudgetDeleted` action (verify not found or inactive)

If missing, add:
```javascript
case 'expectBudget':
  const budgets = await ff3.request('/v1/budgets');
  const found = budgets.data.find(b =>
    b.attributes.name === env.NAME &&
    (!env.EXPECT_ACTIVE || b.attributes.active === (env.EXPECT_ACTIVE === 'true'))
  );
  if (!found) throw new Error(`Budget not found: ${env.NAME}`);
  break;

case 'expectBudgetDeleted':
  const budgets2 = await ff3.request('/v1/budgets');
  const found2 = budgets2.data.find(b => b.attributes.name === env.NAME && b.attributes.active);
  if (found2) throw new Error(`Budget still exists and active: ${env.NAME}`);
  break;
```

---

## Verification Checklist

- [ ] `npm run check` passes (typecheck + lint + test)
- [ ] `npm run db:migrations.upgrade.test.ts` passes (no new migrations, just schema enum)
- [ ] Outbox replay: queue offline (create → rename → delete), sync, verify FF3
- [ ] Local-only delete: create (not synced) + delete → verify no FF3 calls, local cleanup only
- [ ] Conflict: edit in FF3 web UI, rename in app offline → conflict alert in Inbox
- [ ] Cascade: delete budget with limits → verify limit rows removed from cache
- [ ] Subject blocking: queue create, rename, delete offline → verify replayed in sequence
- [ ] Maestro flow B1 passes on test device (create → rename → delete → verify all in FF3)
- [ ] i18n: all keys in en.json, empty in other locales
- [ ] CHANGELOG entry added, correct format

---

## Design Pattern Reference

### Outbox Enqueue Pattern
```typescript
// From src/bucket/actions.ts
return enqueueOperation(db, { id: generateId(), kind: 'create_budget', payload });
```

### Replay with ID Recording
```typescript
// From src/bucket/replay.ts, src/planned/replay.ts
if (!payload.serverId) {
  const response = await client.request<...>('POST /v1/budgets', ...);
  payload.serverId = response.data.id;
  db.update(outboxOperations).set({ payloadJson: writePayload(payload) }).where(...);
}
```

### Conflict Check
```typescript
// From src/sync/outbox.ts (update_transaction)
if (cached.updated_at !== payload.expectedUpdatedAt) {
  throw new Error('conflict');
}
```

### Cascade Deletion
```typescript
// From src/planned/replay.ts (replayDeletePlanned)
await db.delete(plannedObjects).where(eq(plannedObjects.key, key));
```

### Subject Blocking
```typescript
// From src/sync/outboxSubjects.ts
case 'delete_budget':
  add('budget', p.budgetId);
  break;
```

### Confirmation Flow
```typescript
// From app/budget.tsx, src/ui/confirm.ts
const ok = await confirmDestructive(title, actionLabel, message);
if (!ok) return;
await enqueue(...);
```

---

## Summary

**Three new outbox kinds:** `create_budget` (POST /v1/budgets) + `update_budget` (PUT /v1/budgets/{id}) + `delete_budget` (DELETE /v1/budgets/{id})  
**Confirm steps:** Mandatory before queue; create/rename use `confirmAction()`, delete uses `confirmDestructive()` (red button)  
**Local ID:** Client-generated `mmyway-${uuid}` until FF3 responds; recorded as `serverId` in payload  
**Delete behavior:** Real server IDs → DELETE from FF3 + cascade cleanup; unsyncedIDs → local-only removal  
**Subject blocking:** `budget:{id}` prevents races on the same envelope  
**Replay retry:** Create's 422 → adopt existing; update/delete's conflict → fail with alert; delete's local-only → no FF3 call  
**Cascade cleanup:** Budget deletion removes all budget_limit and budget_spent rows from cache  
**Screens:** Budget tab create button → new.tsx sheet; detail page rename + delete buttons with confirmations  
**i18n:** New keys in en.json + empty in every other locale file  
**CHANGELOG:** Three-line entry in Budget section  
**Tests:** Unit (enqueue + replay for all three), screen (create/rename/delete), Maestro (B1 flow covering all three)  
**Implementation:** 3 chunks, ~65k tokens total, ready for parallel agents.

