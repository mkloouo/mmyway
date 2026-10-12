# Rules Surface Implementation Spec

**Date:** 2026-10-12  
**Scope:** Rule groups & rules list with active toggles (both), manual triggers, "Create Rule from Transaction"  
**Outbox kinds:** `trigger_rule`, `toggle_rule_group` (new; `save_planned` reused for rule active toggle)  
**Decisions:** Rules screen = pushed route from Settings; group headers non-collapsible; rule toggle = immediate; trigger = confirm; seed = one rule in named group  

---

## What Already Exists

| Component | Status | Path | Notes |
|-----------|--------|------|-------|
| Rules caching | ✓ DONE | `src/planned/objects.ts` | Rules in `planned_objects`, kind='rule' |
| Rules create/update/delete | ✓ DONE | `src/planned/replay.ts` | Via `save_planned` outbox kind |
| Rule groups sync | ✗ NEW | `src/planned/objects.ts` (add) | Cache in `planned_objects`, kind='rule_group' |
| Rule detail read | ✓ DONE | `app/planned/object/[key].tsx` | Read-only in Planned tab detailed view |
| FF3 rule trigger API | ✓ EXISTS | FF3 POST /v1/rules/{id}/trigger | Needs new `trigger_rule` outbox kind |
| FF3 rule group toggle API | ✓ EXISTS | FF3 PUT /v1/rule-groups/{id} {active} | Needs new `toggle_rule_group` outbox kind |

**Schema note:** Add 'rule_group' to `planned_objects.kind` enum (no migration; just schema update + `npm run db:generate`).  
**Outbox kinds new:** `trigger_rule`, `toggle_rule_group`.  
**Reuse:** `save_planned` for rule active toggle (already handles partial updates).

---

## Implementation: 3 Consolidated Chunks

### Chunk A: Data Layer, Sync & Outbox (tokens: ~80k)

**Schema & outbox kinds (no migration):**

1. **src/db/schema.ts** (modify)
   - Add `'rule_group'` to `plannedObjects.kind` enum (line ~132)
   - Add `'trigger_rule'` and `'toggle_rule_group'` to `outboxOperations.kind` enum

2. **src/sync/outbox.ts** (modify)
   - Add `| 'trigger_rule' | 'toggle_rule_group'` to `OutboxKind` type
   - Import replays, add cases in dispatcher

3. **src/sync/payloadJson.ts** (add schemas)
   ```typescript
   trigger_rule: z.looseObject({ v: version, ruleId: z.string() }),
   toggle_rule_group: z.looseObject({ v: version, ruleGroupId: z.string(), active: z.boolean() }),
   ```

4. **src/sync/outboxSubjects.ts** (modify subjectsOf)
   - Add `case 'trigger_rule'`: `add('rule', p.ruleId);`
   - Add `case 'toggle_rule_group'`: `add('rule_group', p.ruleGroupId);`

**Rule group sync (new):**

5. **src/planned/objects.ts** (modify)
   - Update `pullPlanned()` to fetch `/v1/rule-groups` alongside rules
   - Store them in `planned_objects` as kind='rule_group' with `ff3Id`, `name` (the group's name), `attributesJson` (full rule group object)
   - Modify `PlannedKind` type to include `'rule_group'`

**Replay functions (new):**

6. **src/planned/replay.ts** (add functions)
   ```typescript
   export async function replayTriggerRule(client: FF3Client, payload: TriggerRulePayload): Promise<void> {
     try {
       await client.request(`/v1/rules/${encodeURIComponent(payload.ruleId)}/trigger`, { method: 'POST' });
     } catch (err) {
       if (!(err instanceof FF3RequestError && err.status === 404)) throw err;
     }
   }

   export async function replayToggleRuleGroup(client: FF3Client, payload: ToggleRuleGroupPayload): Promise<void> {
     try {
       await client.request(`/v1/rule-groups/${encodeURIComponent(payload.ruleGroupId)}`, {
         method: 'PUT',
         body: JSON.stringify({ active: payload.active }),
       });
     } catch (err) {
       if (!(err instanceof FF3RequestError && err.status === 404)) throw err;
     }
   }
   ```

**Unit tests (Chunk A):**

7. **src/rules/model.test.ts** (new)
   - Test `rulesGroupedByGroup()` grouping and sorting
   - Test rule group active toggle payload shape

8. **src/sync/outbox.test.ts** or **src/sync/payloadJson.test.ts** (extend)
   - Verify `trigger_rule` and `toggle_rule_group` payloads validate

**Files created:** 2 (objects.ts extends, replay.ts extends, model.test.ts new)  
**Files modified:** 4 (schema.ts, outbox.ts, payloadJson.ts, outboxSubjects.ts)

---

### Chunk B: UI Screens, Actions, i18n, Tests (tokens: ~80k)

**Rule groups & rules list UI:**

1. **app/rules/list.tsx** (new, ~250 lines)
   - Fetch rule groups from `planned_objects` (kind='rule_group')
   - For each group, list rules cached with that group ID
   - Plain section headers (non-collapsible, just Text + SectionHeader UI)
   - Per rule:
     - Title + toggle (immediate, no confirm; queues `save_planned`)
     - "Run now" button with confirmation dialog (confirm required for trigger)
   - Per rule group:
     - Group name + toggle (immediate; queues `toggle_rule_group`)
   - Pull-to-refresh syncs from FF3
   - Empty state if no rules

2. **app/rules/index.tsx** (new, wrapper)
   - Simple route that mounts list.tsx

3. **app/settings.tsx** (modify)
   - Add menu item "Rules" that navigates to `/rules` (pushed route)

**Transaction detail action:**

4. **app/transactions/[groupId].tsx** (modify, ~20 lines)
   - Add "Create rule from transaction" button in action menu
   - Navigates to `/planned/new` with query params:
     - `prefillDescription=${firstSplit.description}`
     - `prefillCategory=${firstSplit.category}`
     - `prefillSource=${firstSplit.source_id}`
     - `prefillDestination=${firstSplit.destination_id}`
   - Planned editor reads these and pre-fills the form

**Rule actions helper:**

5. **src/rules/actions.ts** (new, ~50 lines)
   ```typescript
   export async function triggerRuleNow(db: OutboxDb, ruleId: string): Promise<void> { ... }
   export async function toggleRuleGroupActive(db: OutboxDb, ruleGroupId: string, active: boolean): Promise<void> { ... }
   export async function toggleRuleActive(db: OutboxDb, rule: PlannedObject): Promise<void> {
     // Reuses savePlanned with only active field changed
   }
   ```

**Rule model (helpers):**

6. **src/rules/model.ts** (new, ~60 lines)
   ```typescript
   export interface RuleGroup {
     id: string;
     name: string;
     active?: boolean;
   }
   export interface RuleInGroup {
     id: string;
     title: string;
     active?: boolean;
   }
   export function groupedRulesAndGroups(planned: PlannedObject[]): 
     Array<{ group: RuleGroup; rules: RuleInGroup[] }> { ... }
   ```

**i18n (extend existing rule.* keys):**

7. **src/i18n/locales/en.json** (modify)
   ```json
   "rule": {
     "title": "Rules",
     "active": "Active",
     "inactive": "Inactive",
     "runNow": "Run now",
     "runConfirmTitle": "Trigger rule {{name}}?",
     "runConfirmBody": "Firefly III will apply this rule to matching transactions now.",
     "toggleGroup": "Group active",
     "createFromTransaction": "Create rule from this",
     "noRulesTitle": "No rules",
     "noRulesHint": "Create rules in Firefly III to automate transactions."
   }
   ```

8. **src/i18n/locales/uk-UA.json** + other locales (add empty)

**Screen tests:**

9. **src/__screens__/rules.test.tsx** (new, ~120 lines)
   - Mount Rules screen, verify rule groups + rules render
   - Tap rule toggle, verify `save_planned` queued
   - Tap group toggle, verify `toggle_rule_group` queued
   - Tap "Run now", confirm dialog appears, tap OK, verify `trigger_rule` queued

10. **src/rules/model.test.ts** (new, ~50 lines)
    - Test grouping logic

11. **src/rules/actions.test.ts** (new, ~40 lines)
    - Test queue functions generate correct payloads

**CHANGELOG:**

12. **CHANGELOG.md** (modify)
    ```
    ### Added
    - Rules screen (Settings → Rules): list rule groups and rules, toggle active status on rules and groups, manually trigger rules
    - "Create rule from transaction" action on transaction detail screen
    ```

**Files created:** 6 (list.tsx, index.tsx, actions.ts, model.ts + 3 test files)  
**Files modified:** 4 (settings.tsx, [groupId].tsx, en.json, CHANGELOG.md)

---

### Chunk C: E2E Seed & Maestro Flow (tokens: ~15k)

**Seed modification:**

1. **tools/ff3-test/seed.json** (add)
   ```json
   "rule_groups": [
     {
       "name": "Categorization",
       "active": true
     }
   ],
   "rules": [
     {
       "title": "Groceries Auto-Tag",
       "rule_group_name": "Categorization",
       "trigger_type": "description_contains",
       "trigger_value": "Żabka",
       "actions": [
         { "type": "set_category", "value": "Groceries" }
       ],
       "active": true
     }
   ]
   ```
   (Seed script will POST these to FF3 on `npm run ff3:test -- fresh`)

**Maestro flow:**

2. **.maestro/flows/rules/R1-trigger.yaml** (new, ~40 lines)
   - Start with `ready.yaml`
   - Navigate to Settings → Rules
   - Wait for "Groceries Auto-Tag" visible
   - Tap "Run now", confirm dialog
   - Wait sync
   - Verify FF3 via `runScript` that a matching rule triggered (optional)

3. **.maestro/scripts/ff3.js** (extend, if needed)
   - Add ACTION `expectRule` to verify rule in FF3 by name

**Files created:** 1 flow (R1-trigger.yaml, opt. ff3.js extension)  
**Files modified:** 1 (seed.json)

---

## Database Changes

**Schema update (no migration):** Add `'rule_group'` to `plannedObjects.kind` enum in `src/db/schema.ts`.  
After edit, run: `npm run db:generate` (updates drizzle migrations, no breaking change).  
No schema migration file needed; Drizzle's runtime SQLite accepts the new enum value retroactively.

---

## Implementation Order (by chunk)

**Sequential: A → B → C (can overlap on review)**

1. **Chunk A:** Data layer + sync + outbox replays + unit tests
   - No UI dependency; safe to merge first
   - Enables queuing of trigger/toggle ops
   
2. **Chunk B:** UI screens + actions + i18n + screen tests
   - Depends on Chunk A (to queue ops)
   - Ready once A is merged
   
3. **Chunk C:** Seed + E2E flow
   - Depends on B (to navigate UI)
   - Run last for full integration validation

---

## Confirmation & State Management

- **Rule active toggle:** Immediate, no confirm (low-risk, reversible)
- **Rule group active toggle:** Immediate, no confirm (low-risk)
- **Trigger rule:** REQUIRES confirm dialog (rewrites transactions; user intent verified)
- **Delete rule:** Reuse Planned tab (delete_planned, already implemented)

All ops queue outbox → sync → FF3 → pull planned_objects/rule_groups → UI re-renders.

---

## Performance & Caching

- **Rule groups:** Cached in `planned_objects` as kind='rule_group'; synced alongside rules
- **Grouping:** O(n) on-render; negligible for typical rule counts
- **Payloads:** Minimal (`ruleId`, `ruleGroupId+active`)
- **Partial updates:** `save_planned` and `toggle_rule_group` both support partial FF3 PUTs

---

## Deferred to v2+

- Bulk rule operations (mass trigger)
- Rule preview/dry-run (show matches)
- Rule creation UI from scratch (Firefly III web UI or advanced editor)

---

## Key Design Decisions (per Ponytail)

1. **Sync rule groups** into `planned_objects` as kind='rule_group', not separate table: Avoids new schema, reuses caching pattern, groups cached alongside rules.
2. **Reuse `save_planned` for rule active** instead of new `update_rule`: Rule active is a field in Planned model; no new outbox kind needed.
3. **`toggle_rule_group` as dedicated kind** for group active toggle: Groups don't go through Planned model; need their own outbox kind + replay.
4. **Trigger DOES confirm** (rewrites transactions); toggle does NOT (reversible, low-risk).
5. **No full rule editor:** Planned editor creates rules; "Create from transaction" prefills & reuses it.

---

## Testing Checklist

- [ ] `npm run check` passes (typecheck, lint, test)
- [ ] Schema update: `npm run db:generate` succeeds (rule_group added to enum)
- [ ] Outbox: queue `trigger_rule` & `toggle_rule_group`, replay sends correct FF3 requests
- [ ] Sync: `pullPlanned()` fetches rule groups, caches them as kind='rule_group'
- [ ] UI: Rules screen lists groups & rules, toggles work, "Run now" shows confirm
- [ ] E2E: R1 flow navigates Settings → Rules, triggers rule, verifies in FF3
- [ ] Edge cases: No rules, no groups, group/rule deleted in FF3 (graceful 404), toggle while pending

---

## File Summary (3 Chunks)

### Chunk A: Data + Sync + Outbox
| File | Type | Status | Purpose |
|------|------|--------|---------|
| src/db/schema.ts | modify | Add 'rule_group' to plannedObjects.kind enum |
| src/sync/outbox.ts | modify | Add trigger_rule, toggle_rule_group to OutboxKind; import replays; add dispatcher cases |
| src/sync/payloadJson.ts | modify | Add trigger_rule, toggle_rule_group schemas |
| src/sync/outboxSubjects.ts | modify | Add cases for rule, rule_group subjects |
| src/planned/objects.ts | modify | Update pullPlanned() to sync rule groups; update PlannedKind type |
| src/planned/replay.ts | modify | Add replayTriggerRule(), replayToggleRuleGroup() functions |
| src/rules/model.test.ts | new | Test grouping logic |
| src/sync/payloadJson.test.ts | extend | Validate trigger_rule, toggle_rule_group payloads |

### Chunk B: UI + i18n + Tests
| File | Type | Status | Purpose |
|------|------|--------|---------|
| app/rules/list.tsx | new | Rules screen with groups, toggles, trigger |
| app/rules/index.tsx | new | Route wrapper |
| app/settings.tsx | modify | Add "Rules" menu item → /rules |
| app/transactions/[groupId].tsx | modify | Add "Create rule from transaction" action |
| src/rules/model.ts | new | Helper: groupedRulesAndGroups() |
| src/rules/actions.ts | new | Helpers: triggerRuleNow(), toggleRuleGroupActive() |
| src/i18n/locales/en.json | modify | Add rule.* keys |
| src/i18n/locales/uk-UA.json | modify | Add empty rule object |
| src/__screens__/rules.test.tsx | new | Screen render & interaction tests |
| src/rules/actions.test.ts | new | Outbox queueing tests |
| CHANGELOG.md | modify | Release notes entry |

### Chunk C: E2E
| File | Type | Status | Purpose |
|------|------|--------|---------|
| tools/ff3-test/seed.json | modify | Add rule_groups + rules |
| .maestro/flows/rules/R1-trigger.yaml | new | Trigger flow test |

**Total:** 10 new files, 12 modified; ~700 LOC (code + tests).
