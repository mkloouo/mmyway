# Gap Analysis: Session Dialog Implementation

**Date:** 2026-10-12  
**Current Branch:** worktree-session-dialog-gaps (merged state: main)  
**Target:** Review implementation status of features from session-dialog-2026-10-11.md

---

## Executive Summary

The session dialog requested "quickly implement minor missing things" from three areas:
1. **Biometric app lock** — DONE (41b1902)
2. **Reverse-proxy headers (TLS + Cloudflare Access)** — DONE (41b1902)
3. **Account CRUD** — MISSING
4. **Cash flow + net worth dashboard** — MISSING
5. **Rules surface** — MISSING
6. **Notification listener** — DISCARDED (documented as out-of-scope)

Budget/envelope creation from the app is **NOT implemented**. The budget system is read-only for envelopes: assignment and movement work on existing FF3 budgets only.

---

## Detailed Status by Feature

### 1. ACCOUNT CRUD — MISSING

**Requirement (from dialog §99–108):**
- Create new accounts via `POST /v1/accounts` (Asset, Liability, Cash, Revenue, Expense)
- Support liability fields: interest rate, payment frequency, credit limit, archiving
- New screen: `app/accounts/new.tsx`
- Expand `src/accounts/accountEdit.ts` with liability fields
- New outbox kind: `create_account` (appended after bucket's `set_budget_limits`/`set_piggy_amount`)
- Register in: `src/db/schema.ts` outboxOperations.kind, `src/sync/outbox.ts` OutboxKind, `src/sync/payloadJson.ts` SCHEMAS, `src/sync/outboxSubjects.ts` subjectsOf
- Add both locales, tests, CHANGELOG entries

**What exists:**
- `app/accounts/[id].tsx` — edit existing account screen (DONE)
- `src/accounts/accountEdit.ts` — currently handles only rename, currency, role, include_net_worth, opening_balance, virtual_balance, credit_card_type, monthly_payment_date, notes (no interest, credit limit, frequency)
- `app/settings/accounts.tsx` — account list with reorder
- Outbox operations: `update_account`, `reorder_accounts` (no `create_account`)

**What's missing:**
- `app/accounts/new.tsx` screen
- Liability-related fields in `accountEdit.ts` (interest_rate, credit_limit, liability_amount_per, account_role for Liability types)
- `create_account` outbox kind (enum value, schema, replay logic)
- FF3 client POST /v1/accounts call
- Payload marshalling for new-account create
- Conflict handling / updated_at comparison for account create responses
- Tests for account creation flow
- i18n strings for liability fields

**Relevant files to reuse:**
- `src/sync/outbox.ts:replayUpdateAccount()` as pattern for account write replay
- `src/db/schema.ts` outboxOperations enum (line 102–118)
- `src/sync/payloadJson.ts` SCHEMAS map (register here)
- `src/sync/outboxSubjects.ts` subjectsOf() (add account:<id> subject for create)
- `src/accounts/accountEdit.ts` diff logic as foundation (add liability fields to AccountEdit, AccountForm)

**FF3 Endpoints:**
- `POST /v1/accounts` — [Firefly III API v6.7.7, POST routes](https://docs.firefly-iii.org/reference/new-account)
  - Required: name, account_type, account_role, currency_code
  - Optional for liabilities: interest_rate, credit_limit, liability_start_date, account_role
  - Returns account object with id, type, attributes

---

### 2. CASH FLOW + NET WORTH DASHBOARD — MISSING

**Requirement (from dialog §109–111):**
- Cashew-styled plain Views (no new dependencies; `react-native-svg` rejected)
- Two components: Cash flow (income vs. expenses) and Net worth
- New route: `app/insights.tsx` + `src/insights/**` module
- Opened from Activity tab's app bar button
- Not a 6th tab (pushed route, not tab)

**What exists:**
- Activity tab with app bar (can add button)
- No `app/insights.tsx` file
- No `src/insights/` directory
- No chart/graph components in `src/ui/`
- Existing `src/ui/` has: Screen, AppBar, TextField, PickerSheet, Card, Row, Money, theme utils (no visualization)

**What's missing:**
- `src/insights/` module structure (likely: cashedFlow.ts, netWorth.ts, types.ts)
- `app/insights.tsx` screen
- Cash flow calculation: aggregate income/expense transactions by period
- Net worth calculation: sum asset/liability balances over time
- Visualization components (bar chart, line chart, or summary cards — Cashew uses Material Design)
- Historical data fetch or transaction analysis
- i18n for insights labels
- Tests for calculations

**Relevant files to reuse:**
- `src/ui/components.tsx` — Card, Row, Money, Screen, AppBar patterns
- `src/transactions/` — transaction query utilities (type filtering, date filtering)
- `src/accounts/` — asset/liability balance aggregation
- `src/sync/referenceData.ts` — data-fetch pattern
- `app/(tabs)/activity.tsx` as navigation source (add bar button opening insights)

**FF3 Endpoints:**
- `GET /v1/transactions?start=…&end=…&type=expense|income` (already used elsewhere; paginate with fetchAllPages)
- `GET /v1/accounts?type=asset|liability` (already cached in reference_accounts)
- No new endpoints needed

**Design notes from commercialization-and-roadmap.md §2.4:**
- "Monthly cash flow: income vs. expenses" (horizontal bar or stacked bar)
- "Monthly net worth: sum of net assets" (line chart or monthly cards)
- No chart library chosen yet; Cashew uses SVG-based Material Charts (app uses plain Views for budget tab)

---

### 3. RULES SURFACE — MISSING

**Requirement (from dialog §114–115):**
- Rule groups list/toggle
- "Create Rule from Transaction" action
- Trigger rules support
- Fresh `src/rules/**` + `app/rules/**` modules
- Read `planned_objects` table directly (drizzle) rather than using planned agent's helpers
- Outbox kinds: `save_rule`, `trigger_rule`

**What exists:**
- `planned_objects` table caches FF3 bills, rules, and recurrences (rules exist in cache)
- No dedicated UI for rules
- No rule-creation or trigger logic
- No outbox support for rule operations

**What's missing:**
- `app/rules/` directory and screens
- `src/rules/` module with rule model, edit, replay
- Rule listing UI (group by status/type)
- "Create Rule from Transaction" — action sheet or screen overlay
- Rule trigger UI (manual "run this rule now")
- `save_rule` outbox kind (for create/update rules)
- `trigger_rule` outbox kind (for running a rule immediately)
- Replay logic for rule create/update/trigger
- i18n for rule labels
- Tests for rule operations

**Relevant files to reuse:**
- `src/planned/objects.ts` — pattern for reading rules from `planned_objects`
- `src/planned/model.ts`, `labels.ts` — planned transaction edit patterns (rules will be similar)
- `src/sync/outbox.ts` — replay pattern (replayUpdatePlanned as template)
- `src/sync/payloadJson.ts` — payload schema registration
- `src/sync/outboxSubjects.ts` — subject blocking (rule:<id>)
- Transaction detail screen — add "Create Rule" button
- `src/ui/confirm.ts` — rule confirmation pattern

**FF3 Endpoints:**
- `GET /v1/rules` (already cached in planned_objects under kind='rule')
  - Carries id, title, trigger, actions, stop_processing, active, etc.
- `POST /v1/rules` — create rule
  - Required: title, trigger_type, trigger_value, actions[] (each with type, value)
- `PUT /v1/rules/{id}` — update rule
  - Partial updates (similar to recurrence update)
- `DELETE /v1/rules/{id}` — delete rule
- `POST /v1/rules/{id}/trigger` — manually trigger a rule
  - Returns count of affected transactions

**Design notes from session dialog:**
- No UI detail provided — "rule groups list/toggle" suggests a collapsible rule-type grouping
- "Create Rule from Transaction" implies context menu or button on transaction detail
- Trigger is likely a button on rule detail or list row

---

## BUDGET/ENVELOPE CREATION — NOT IN SCOPE FOR APP

**Critical finding:** The current budget implementation does NOT include creating new envelopes (FF3 budgets).

**What is implemented:**
- Read budgets from FF3 (cached in bucket_objects via `GET /v1/budgets?start&end`)
- Create/update/delete budget LIMITS within existing budgets (POST/PUT/DELETE /v1/budgets/{id}/limits)
- Read piggy banks (sinking funds) and fund them (PUT /v1/piggy-banks/{id})

**What is NOT implemented:**
- No `POST /v1/budgets` call (create a new budget/envelope)
- No `app/budget/new.tsx` or "Create Budget" UI
- No outbox kind for budget creation

**Why this matters:**
- Users cannot create new envelopes from the app; they must use Firefly III's web UI
- Session dialog §100–101 references "account CRUD" but does not explicitly ask for budget/envelope CRUD
- ynab-bucket-budgeting-plan.md §5 ("not in v1") says "Piggy-bank creation and deletion" is out of scope (roadmap §2.3's CRUD)
- Implication: envelope creation was deferred, not forgotten

**FF3 Endpoint (for reference, not implemented):**
- `POST /v1/budgets` — create budget
  - Required: name, currency_code
  - Optional: active
  - Returns budget object with id

---

## Test Coverage Status

### Unit Tests (✓ = comprehensive, ✗ = missing)

**Budget (bucket) module:**
- ✓ `src/bucket/period.test.ts` — period boundaries
- ✓ `src/bucket/envelopes.test.ts` — envelope calculations
- ✓ `src/bucket/funds.test.ts` — piggy bank handling
- ✓ `src/bucket/rta.test.ts` — Ready to Assign formula (incl. overspent case)
- ✓ `src/bucket/limitWrite.test.ts` — budget limit POST/PUT/DELETE logic
- ✓ `src/bucket/replay.test.ts` — outbox replay of set_budget_limits and set_piggy_amount
- ✓ `src/bucket/autofill.test.ts` — auto-fill priority order, exact RTA exhaustion
- ✓ `src/bucket/actions.test.ts` — user action handlers

**Screen tests:**
- ✓ `src/__screens__/budget.test.tsx` — Budget tab renders, shows RTA, shows limits, overspent

**Planned (recurrence) module:**
- ✓ `src/planned/*.test.ts` — ~15 test files covering model, labels, replay, etc.

**Account module:**
- ✓ `src/accounts/accountEdit.test.ts` — diff logic
- ✓ `src/accounts/accountActions.test.ts` — account update/reorder
- ✗ `src/accounts/accountCreate.test.ts` — MISSING (no file)

**Rules module:**
- ✗ All missing (no src/rules/*)

**Insights module:**
- ✗ All missing (no src/insights/*)

### E2E/Maestro Flows

**Budget scenarios:**
- ✗ No `.maestro/flows/budget/` directory (no E2E flows for budget feature)
- Comparison: Planned has `P1-create-reschedule-delete.yaml`, Capture has multiple flows

**Critical paths from dialog §138–169:**
- §9: `npm run check` + `npm run analyze` (not yet run on merged tree with all three agents)
- §10: `src/db/migrations.upgrade.test.ts` must pass (checks for unregistered migrations after 0014)
- §11: Outbox replay order: queue one of each new kind offline, confirm strict `sequence` and subject blocking
- §12: `npm run ff3:test -- fresh` + Maestro checklist against stock 6.7.7
- §13: Budget tab end-to-end on test instance: Ready to Assign, assign, move, auto-fill, cover overspent

---

## Merge Status & Collision Points

**Committed state:**
- `planned` branch (8737303) — clean, 2 commits ahead of main
- `ynab-bucket-budgeting` branch (ca6e531) — clean, 6 commits ahead of main
- `worktree-imp-misc-features` branch — merged into main via 6b42490, but agent noted "uncommitted" state (CHANGELOG, partial implementations)

**Known collision points resolved:**
- `src/i18n/locales/{en,uk-UA}.json` (all three agents touched)
- `app/(tabs)/settings.tsx` (planned + imp-misc-features)
- `src/sync/payloadJson.ts` (planned + bucket)
- `src/settings/{appSettings,loadSettings}.ts` (planned + imp-misc-features)
- `CHANGELOG.md` (all three)
- `src/api/ff3/auth.ts` — avoided by imp-misc-features using separate proxyHeaders.ts snapshot

**Current main state:**
- All three branches merged
- Last commits: 39beae7 (fix tab refs in maestro), 3ca8404 (fix more flows), 841ffa3 (fix more labels)
- CHANGELOG updated with features in [1.11.0]

---

## Migration & Database Status

**Registered migrations:**
- `src/db/migrations.ts` must include 0014_lowly_shiva.sql (bucket_objects table creation)
- ✓ Confirmed: bucket module added 0014 migration
- Entry in migrations.ts is required for `src/db/migrations.upgrade.test.ts` to pass

**Unregistered migrations would fail:**
- Any migration numbered ≥0015 that is not in `src/db/migrations.ts` will cause the upgrade test to fail

**For account/rule/insights work:**
- No new migrations needed for account creation (existing account schema)
- Rules and insights read existing data (no schema changes)
- Caveat: if account create needs new fields (e.g., interest_rate, credit_limit) and those aren't in FF3's own schema, they go straight into the FF3 API request body (no local storage)

---

## Payload Schemas & Outbox Registration

**Currently registered outbox kinds** (src/db/schema.ts L102–118):
```
'create_transaction' | 'update_transaction' | 'delete_transaction'
'attach_receipt' | 'delete_attachment'
'recurring_review'
'update_account' | 'reorder_accounts'
'save_planned' | 'delete_planned' | 'trigger_planned'
'set_budget_limits' | 'set_piggy_amount'
```

**Missing kinds for full implementation:**
1. `'create_account'` — new
2. `'save_rule'` — new (or create_rule, update_rule as separate; FF3 typically uses PUT for both)
3. `'trigger_rule'` — new (similar to trigger_planned)

**Payload schema file** (`src/sync/payloadJson.ts`):
- Registers each kind with its Zod schema
- Each new kind needs: payload interface + zod schema + version info
- Example: `SetBudgetLimitsPayload` interface → zod validation → SCHEMAS map entry

**Subject blocking file** (`src/sync/outboxSubjects.ts`):
- Each kind maps to subjects (e.g., `account:<id>` for account writes, `budget:<id>` for budget operations)
- New kinds need subject registration so related ops queue properly
- Example: `create_account` would create subject `account:${newIdOrTemp}`; `save_rule` would use `rule:<id>`

---

## Recommended Implementation Order

1. **Account CRUD (Phase 1 of 3)**
   - Smallest scope, unblocked by others
   - Prerequisite files already exist (accountEdit.ts, update_account replay)
   - Outbox integration is straightforward
   - Blocks: nothing
   - Files: ~3 new (accountCreate.ts, accountNew.tsx, payloads for create)

2. **Cash Flow + Net Worth (Phase 2 of 3)**
   - Unblocked; uses existing transaction queries
   - No new outbox kinds or API endpoints
   - Moderate scope: calculation logic + rendering
   - Blocks: nothing
   - Files: ~4 new (cashedFlow.ts, netWorth.ts, src/insights/*, app/insights.tsx)

3. **Rules Surface (Phase 3 of 3)**
   - Medium scope: list, create, trigger
   - Requires outbox integration (new kinds)
   - Blocks: nothing (independent of account CRUD and insights)
   - Files: ~6 new (src/rules/model.ts|replay.ts|actions.ts, app/rules/list.tsx|detail.tsx|create.tsx)

---

## Verification Checklist Before Shipping

- [ ] `npm run check` passes (typecheck + lint + test)
- [ ] `npm run analyze` passes (dead code, cycles, import cycles)
- [ ] `src/db/migrations.upgrade.test.ts` passes (all migrations registered)
- [ ] Outbox replay order: manually queue one of each new kind, confirm no data loss and subject blocking works
- [ ] `npm run ff3:test -- fresh` + Maestro flows pass on stock 6.7.7
- [ ] Budget tab e2e: Ready to Assign, assign, move, auto-fill, cover overspent on test instance
- [ ] Account creation e2e: create asset, liability, verify in FF3's account list
- [ ] Insights e2e: load cash flow and net worth, verify numbers match Activity tab's total income/expenses
- [ ] Rules e2e: create rule from transaction, trigger, verify in Planned tab

---

## Files & Endpoints Summary

### Account CRUD
- **Files to create:** app/accounts/new.tsx, src/accounts/accountCreate.ts (or extend accountEdit.ts)
- **Files to modify:** src/db/schema.ts, src/sync/outbox.ts, src/sync/payloadJson.ts, src/sync/outboxSubjects.ts, src/accounts/accountEdit.ts, app/settings/accounts.tsx
- **FF3 API:** POST /v1/accounts (create), GET /v1/accounts (read — already done)
- **Outbox kind:** `create_account` — new

### Cash Flow + Net Worth
- **Files to create:** app/insights.tsx, src/insights/cashFlow.ts, src/insights/netWorth.ts, src/insights/types.ts
- **Files to modify:** app/(tabs)/activity.tsx (add bar button)
- **FF3 API:** GET /v1/transactions, GET /v1/accounts (both already cached)
- **Outbox kinds:** none

### Rules Surface
- **Files to create:** app/rules/list.tsx, app/rules/detail.tsx, src/rules/model.ts, src/rules/replay.ts, src/rules/actions.ts
- **Files to modify:** src/db/schema.ts, src/sync/outbox.ts, src/sync/payloadJson.ts, src/sync/outboxSubjects.ts, app/planned/[key].tsx (add "create rule" action)
- **FF3 API:** POST /v1/rules (create), PUT /v1/rules/{id} (update), DELETE /v1/rules/{id}, POST /v1/rules/{id}/trigger
- **Outbox kinds:** `save_rule` (create/update), `trigger_rule` (new)

---

## Open Assumptions & Risks

1. **Account currency CRUD:** Not specified whether account creation accepts multi-currency or only primary FF3 currency. Assume FF3 API validation applies.

2. **Liability account payee:** New liability accounts may need a "payee" account in Firefly III's sense (creditor). Unclear whether the app creates that automatically or leaves it to FF3.

3. **Chart library for insights:** No library chosen. Current `src/ui/` has no visualization primitives. Options:
   - Custom SVG (small, app already uses plain Views)
   - `react-native-svg` (explicitly rejected in dialog)
   - Render as styled cards/rows with bars drawn as View widths (matches current budget tab style)
   - Defer chart and show numeric summary cards only

4. **Rules scope:** FF3 has rule types (email, event) and trigger/action combinations. Unclear whether the app surface all, or a curated subset. Assume: all, mirroring Planned tab's "show what FF3 holds" pattern.

5. **Rule trigger:** FF3's POST /v1/rules/{id}/trigger is a manual run. Does "trigger_rule" outbox kind mean:
   - A queued "run this rule now" user action? (likely)
   - Or sync-triggered rule replay after create/update? (covered by save_rule)
   Assume: both (outbox kind is idempotent).

6. **Budget creation:** Dialog says "account crud" but not "budget/envelope crud". Envelope creation is explicitly out of scope for v1 (ynab-bucket-budgeting-plan.md §5). This report flags it as MISSING but not a blocker for the three main features.

