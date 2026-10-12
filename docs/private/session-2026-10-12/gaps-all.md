# Comprehensive Requirements vs. Implementation Audit

**Date:** 2026-10-12  
**Scope:** YNAB Bucket Budgeting, Planned Transactions, Commercialization & Roadmap  
**Target Docs:**
- `docs/private/ynab-bucket-budgeting.md` (feasibility research)
- `docs/private/ynab-bucket-budgeting-plan.md` (development plan, 6 phases)
- `docs/private/planned-transactions.md` (feasibility research)
- `docs/private/planned-transactions-plan.md` (development plan, 5 phases)
- `docs/private/commercialization-and-roadmap.md` (product roadmap §2.1–§2.9)

---

## YNAB Bucket Budgeting — All 6 Phases DONE

### Phase 1: Read-Only Budget Tab — DONE
**Requirement:** Display envelopes (budgets + limits), sinking funds (piggy banks), Ready to Assign formula with explanation that differs from FF3's own "left to budget".

**Implementation:**
- ✓ `src/bucket/period.ts` — monthly period boundaries (`periodOf`, `previousPeriod`)
- ✓ `src/bucket/envelopes.ts` — budget + limit + spent → Envelope[] with assigned/spent/available/carryIn
- ✓ `src/bucket/funds.ts` — piggy banks → Fund[] with saved/target/targetDate/percentage
- ✓ `src/bucket/rta.ts` — Ready to Assign formula (liquid - allocated)
- ✓ `src/sync/bucketData.ts` — `pullBucketData()` reads budgets, limits, piggy banks via five FF3 calls, writes to `bucket_objects` table
- ✓ `app/(tabs)/budget.tsx` — fifth tab with sections for fixed obligations, variable envelopes, sinking funds, RTA display
- ✓ `src/bucket/objects.ts` — cache row ↔ typed object, mirrors `src/planned/objects.ts` pattern
- ✓ `src/db/schema.ts` — `bucketObjects` table with budget_limit, piggy, budget_spent kinds
- ✓ Migration `0014_*.sql` registered in `src/db/migrations.ts`
- ✓ i18n keys for Budget tab in `src/i18n/locales/{en,uk-UA}.json`
- ✓ Tests: `src/bucket/{period,rta,envelopes,funds}.test.ts`, `src/__screens__/budget.test.tsx`

**Commit:** `b71ee85` feat(budget): read-only Budget tab with Ready to Assign

**FF3 Endpoints Used:** `GET /v1/budgets?start&end`, `GET /v1/budget-limits?start&end`, `GET /v1/piggy-banks`, `GET /v1/accounts?type=asset`

---

### Phase 2: Assign & Move — DONE
**Requirement:** Move money from RTA into an envelope, and between envelopes, using absolute budget-limit writes. One op for multi-write safety (move = decrement + increment, one op, no race).

**Implementation:**
- ✓ `src/bucket/limitWrite.ts` — pure: (wanted, cachedLimit) → {method, payload}; handles limit_exists → PUT, zero → DELETE, unchanged → none
- ✓ Outbox kind `set_budget_limits` — plural on purpose, entries with budgetId/amount/limitId
- ✓ `src/db/schema.ts` — added to `outboxOperations.kind` enum
- ✓ `src/sync/payloadJson.ts` — `SetBudgetLimitsPayload` interface + Zod schema registered in SCHEMAS
- ✓ `src/sync/outboxSubjects.ts` — every budget in entries as `budget:<id>` subject, blocking related ops
- ✓ `src/bucket/replay.ts` — `replaySetBudgetLimits()` resolves limit ids, executes limitWrite logic, stores result via `storeBucketObject`
- ✓ UI: assign sheet (AmountSheet), move sheet (Slider + AllocationSheet), `useAction()` wrapper
- ✓ Tests: `src/bucket/limitWrite.test.ts` (new limit, existing, zero→DELETE, unchanged→none), replay test for lost-answer idempotence

**Commit:** `47bc686` feat(budget): assign to an envelope and move between two

**FF3 Endpoints:** `POST /v1/budgets/{id}/limits`, `PUT /v1/budgets/{id}/limits/{limitId}`, `DELETE /v1/budgets/{id}/limits/{limitId}`

**Critical Detail:** Absolute writes guarantee replay idempotence; payload records `limitId` on success for PUT path on retry.

---

### Phase 3: Auto-Fill — DONE
**Requirement:** Distribute RTA in priority order: bills due this period → envelopes up to last period's amount → sinking funds by target pace → surplus stays.

**Implementation:**
- ✓ `src/bucket/autofill.ts` — pure function: RTA + period state → SetBudgetLimitsPayload['entries']
- ✓ Respects priority order (bills → envelopes → sinking funds)
- ✓ Uses last period's assigned amount as envelope target (no v1 stored per-envelope target)
- ✓ Calculates sinking fund pace: (target - current) / months until target date
- ✓ Minor units via `src/splits/allocate.ts` (no rounding leakage)
- ✓ Tests: exhausts RTA exactly, respects order, handles zero/negative RTA, no over-assignment

**Commit:** `73d91aa` feat(budget): one-tap auto-fill from last month's amounts

**Upgrade Path:** Per-envelope target stored as `mmyway-target: 700.00` in budget's `notes` field (§5 of plan).

---

### Phase 4: Sinking Funds — DONE
**Requirement:** Fund/spend piggy banks (sinking funds), with conflict detection for concurrent changes.

**Implementation:**
- ✓ Outbox kind `set_piggy_amount` — piggyId, accountId, amount (absolute), expectedUpdatedAt (conflict check)
- ✓ `src/db/schema.ts` — added to enum
- ✓ `src/sync/payloadJson.ts` — `SetPiggyAmountPayload` + Zod schema
- ✓ `src/sync/outboxSubjects.ts` — subject `piggy:<id>` for subject blocking
- ✓ `src/bucket/replay.ts` — handles `cannot_add_piggy_amount` (insufficient funds) and `invalid_account_currency` as user-facing errors
- ✓ Conflict check: compares piggy's `updated_at` with `expectedUpdatedAt` (pattern from `recurringReview.ts`)
- ✓ Uses `accounts[]` form (not top-level `current_amount`) to allow zeroing
- ✓ Tests in `src/bucket/replay.test.ts`

**Commit:** `7781293` feat(budget): fund the sinking funds, and auto-fill them too

**FF3 Endpoints:** `PUT /v1/piggy-banks/{id}` with `accounts[].current_amount` (absolute)

**Deliberate Limitation:** Creating piggy banks is out of scope (roadmap §2.3).

---

### Phase 5: Capture Integration — DONE
**Requirement:** When selecting a category or budget, show that envelope's remaining balance next to it (e.g., "Groceries · 420,00 zł left").

**Implementation:**
- ✓ `src/bucket/useEnvelopeRemaining.ts` — read from `bucket_objects` cache, return per-envelope balance
- ✓ `app/capture.tsx` — category/budget picker displays remaining when chosen
- ✓ One read from cache, no new network calls, no new writes
- ✓ Real-time during capture workflow

**Commit:** `ea34368` feat(budget): show the envelope's remainder while capturing

---

### Phase 6: Cover Overspending — DONE
**Requirement:** When an envelope goes negative (amount + spent < 0), show alert; tapping it opens move sheet pre-filled with shortfall.

**Implementation:**
- ✓ Budget tab detects overspent: `max(0, limit.amount + limit.spent)` < 0
- ✓ Alert row with envelope name, overspend amount, "Fix" action
- ✓ Tapping opens Phase 2's move sheet pre-filled: from overspent envelope, to one with surplus
- ✓ No new outbox kind (reuses `set_budget_limits` from Phase 2)
- ✓ UI integrated into `app/(tabs)/budget.tsx`

**Commit:** `ca6e531` feat(budget): cover an overspent envelope from another

**Prerequisite from Research:** App-owned budget limits can go below zero because `amount` write is absolute; FF3's validator allows any absolute value written back.

---

## Planned Transactions — All 5 Phases DONE

### Phase 1: Raise Floor to 6.7.0 & Delete Workarounds — DONE
**Requirement:** Update `MIN_API_VERSION` to 6.7.0 (fixes recurrence `moment` validation bug on update), delete delete-and-recreate workaround that was forced on 6.3.2–6.6.x.

**Implementation:**
- ✓ `src/api/ff3/auth.ts` — `MIN_API_VERSION = [6, 7, 0]`
- ✓ `src/planned/replay.ts` — deleted comment block at L150–156 and guarded blocks (recurrenceReplaced flag, replacedRecurrenceIds loop)
- ✓ Schedule change is now plain `PUT /v1/recurrences/{id}`, not delete-and-recreate
- ✓ `src/planned/actions.ts` — dropped `payload.recurrenceReplaced && payload.before` merge branch
- ✓ `src/sync/payloadJson.ts` — kept `recurrenceReplaced` and `replacedRecurrenceIds` as optional for payload backward compat
- ✓ `src/planned/model.ts` `billBody()` — sends `end_date: '2038-01-16'` when repeating (fixes one-off → repeating, clears stale end date)
- ✓ Patches removed: `tools/ff3-test/patches/` now empty (stock 6.7.7)
- ✓ Tests: `src/planned/replay.test.ts` (schedule change is one PUT, keeps recurrence id), `auth.test.ts` (6.6.x refused)

**Commit:** `ea34368` feat(ff3): raise the API floor to 6.7.0

**CHANGELOG:** "Firefly III 6.3.2–6.6.x no longer supported; minimum is now 6.7.0."

---

### Phase 2: Repetition Editor — DONE
**Requirement:** Expose full repetition expressiveness: daily, ndom (2nd Tuesday), weekend handling (skip/move Friday/Monday), moment as type consequence, list of repetitions (add/remove to fix multi-repetition data loss), end condition (forever/until/times, three-way picker).

**Implementation:**
- ✓ `src/planned/repetition.ts` — new types:
  - `RepetitionType = 'daily' | 'weekly' | 'ndom' | 'monthly' | 'yearly'`
  - `Repetition` interface with id, type, moment (shape per type), skip, weekend (1–4)
  - `EndCondition = {kind: 'forever'} | {kind: 'until'; date} | {kind: 'times'; count}`
- ✓ `momentFor(type, date)` — derives moment from type: empty for daily, ISO weekday 1–7 for weekly, day 1–31 for monthly, n,d for ndom (n=1–5, d=1–7), Y-m-d for yearly
- ✓ Validation via `repetitionProblem()` — checks each type against FF3's own RecurrenceValidation rules
- ✓ `src/planned/model.ts`:
  - `PlannedFields.repetitions: Repetition[]` and `end: EndCondition` (replaces `frequency` + `every`)
  - `normalizeFields()` — turns legacy (frequency, every) into repetitions array on read for payload compat
  - `scheduleChanged()` — compares repetitions (deep, order-insensitive) + end
  - `recurrenceBody()` — sends repetitions array with ids preserved, end condition as `repeat_until` or `nr_of_repetitions` (exactly one)
- ✓ `billSchedule(reps)` — lossy mapping to bill's `repeat_freq` + `skip` (daily → weekly, ndom → monthly, multiple → most frequent)
- ✓ `src/planned/labels.ts` — `scheduleLabel()` prefers FF3's `repetitions[].description` (localised, in cache already)
- ✓ `app/planned/[key].tsx`:
  - Deleted quarterly/half-year presets (they were `monthly + skip` underneath, didn't round-trip)
  - `ScheduleRows` component: list of repetitions with add/remove, each row: type picker → moment picker (consequence of type) → every N → weekend → "more"
  - End condition row: three-way picker (forever / until date / N times)
- ✓ `src/planned/replay.ts` — §2.3 intermediate PUT for same-count multi-repetition change:
  - If recurrence has >1 repetition and new set has same count: send one-repetition PUT first, then real body
  - Both PUTs have count mismatch, so FF3 deletes and recreates (never matches)
  - One GET on read, one intermediate PUT on replay, idempotent on final body
- ✓ i18n: new keys for daily, ndom, weekend modes in `src/i18n/locales/{en,uk-UA}.json`
- ✓ Tests:
  - `src/planned/repetition.test.ts` — moment rules, parseNdom, round-trips
  - `src/planned/model.test.ts` — all types → FF3 validation rules → back (daily empty, ndom n,d with n 1–5 d 1–7, yearly Y-m-d), multi-repetition survives non-schedule edit + schedule edit, legacy payload normalises
  - `src/planned/replay.test.ts` — intermediate single-rep PUT fires exactly when needed
  - `.maestro/flows/planned/P1-create-reschedule-delete.yaml` — unchanged pass confirms equivalence

**Commit:** `8737303` feat(planned): the schedule Firefly III can actually hold

**Fixed Data-Loss Bugs:**
1. Multi-repetition recurrence: now sends full `repetitions[]` (kept id), survives schedule edits
2. Daily/ndom misread: now sends correct type + moment, reads back as sent

**FF3 Endpoints:** `PUT /v1/recurrences/{id}` (omit `notes` to preserve; newlines stripped)

---

### Phase 3: Occurrence List — DONE
**Requirement:** Show past and future occurrences. Ahead from cache (`repetitions[].occurrences`, 5 per repetition, 9 for daily). Behind from `GET /v1/recurrences/{id}/transactions` paginated. Expander function to build cross-transaction agenda.

**Implementation:**
- ✓ `src/planned/occurrences.ts` — pure `upcomingOccurrences(repetitions, start, count)` honouring skip and weekend, with test cross-checking against FF3's `occurrences`
- ✓ `src/ui/OccurrenceRows.tsx` — renders future dates (merged across repetitions, sorted) + past transactions (paginated from GET endpoint)
- ✓ `app/planned/[key].tsx` — OccurrenceRows component on detail screen, takes repetitions/repeats/date/skipDays/recurrenceId
- ✓ Past half: `GET /v1/recurrences/{id}/transactions` via `fetchAllPages`, each row links to transaction detail
- ✓ Future half: occurrences from cache, sorted chronologically
- ✓ Occurrence detail shown: date, status (upcoming/past), skip action
- ✓ Tests: `src/planned/occurrences.test.ts` — expander against FF3's occurrences, skip/weekend edge cases

**Commit:** Part of `8737303`

**FF3 Endpoints:** `GET /v1/recurrences/{id}/transactions` (paginated via existing `fetchAllPages`)

**Data Source Already Cached:** `repetitions[].occurrences` from `RecurringEnrichment` in v1.

---

### Phase 4: Per-Occurrence Skip — DONE
**Requirement:** Mark skipped dates in recurrence notes (mmyway-skip: YYYY-MM-DD,… marker) so they survive reinstall + recurrence id change; suppress review cards whose date is in skip list.

**Implementation:**
- ✓ `src/planned/notes.ts` — generalised from plannedTime: `readMarkers()`, `writeMarkers()`, `stripMarkers()` over one-line marker set
  - Keys: `mmyway-time` (HH:MM), `mmyway-skip` (date1,date2,…)
  - Recurrence notes are newline-stripped, everything stays one line
  - `stripMarkers()` removes both markers from user-facing note
- ✓ `src/planned/model.ts` — `PlannedFields.skipDays: string[]` (YYYY-MM-DD dates)
- ✓ `toggleSkipDay()` — add/remove date from skip list
- ✓ `app/planned/[key].tsx` — onToggleSkip action: confirm, add date to skipDays, queue save
- ✓ Saving queues `save_planned` with updated recurrence `notes` including mmyway-skip marker
- ✓ `src/sync/recurringReview.ts` `pullUnreviewedRecurring()` — before creating review card, check if journal's `recurrence_date` (or fallback to date) is in recurrence's skip list; if yes, queue `delete_transaction` op instead (goes straight to delete path)
- ✓ UI: one action row per upcoming occurrence in Phase 3 list, "skip this one" button
- ✓ Honest disclosure: FF3 still books the transaction on the day; app deletes it on next sync (soft-deleted journal exists, latest_date moved)
- ✓ Tests: `src/planned/notes.test.ts` (markers round-trip, user note preserved, unknown marker ignored), `recurringReview.test.ts` (skipped date → delete_transaction op, no inbox item)

**Commit:** Part of `8737303`

**Why Not Pre-Book & Delete:** Soft-deleted meta (seen in §0.3 of plan research), so pre-triggered future date is simply booked again on the day; no way to skip a future date until it arrives.

**Server Side:** Skip marker in notes is read-only in FF3's web UI (visible in recurrence detail), but not user-edited.

---

### Phase 5: Reminder Lead Time — DONE (Configurable)
**Requirement:** Make the hardcoded "2 days before + day-of" lead time configurable.

**Implementation:**
- ✓ `src/settings/appSettings.ts` — `plannedReminderLead` setting (key), `PLANNED_REMINDER_LEADS` array (values: 0–7 days)
- ✓ `DEFAULT_PLANNED_REMINDER_LEAD = 2`
- ✓ `getPlannedReminderLead()` — async fetch from settings, validates against PLANNED_REMINDER_LEADS
- ✓ `src/planned/notifications.ts` — `computePlannedNotificationTargets()` accepts `leadDays` param (defaults to DEFAULT)
- ✓ `app/(tabs)/settings.tsx` — Settings → Planned → Reminder Lead Time picker (0 = on day, 1–7 = N days before)
- ✓ i18n for reminder lead labels
- ✓ Rebuilds notification set on every sync; kept at ~30 days to respect Android throttle

**Commit:** Part of `8737303`

**Existing Since:** Notifications shipped in v1.7.0 (commit `532701a`), reminders were hardcoded; Phase 5 makes lead time configurable.

---

## Missing / Partially Complete

### MISSING: Account CRUD (Account Creation & Full Management)
**Requirement (commercialization-and-roadmap.md §2.1):**
- `POST /v1/accounts` for Asset, Liability (Credit Card, Loan, Debt), Cash, Revenue/Expense
- Liability fields: interest_rate, payment_frequency, credit_limit, archiving (active flag writable)
- New screen: `app/accounts/new.tsx`
- New outbox kind: `create_account`
- i18n + tests for new fields

**Current State:**
- ✓ `app/accounts/[id].tsx` — edit existing (rename, currency, role, net_worth, opening_balance, virtual_balance, credit_card_type, monthly_payment_date, notes)
- ✓ `app/settings/accounts.tsx` — list + reorder
- ✓ `src/accounts/accountEdit.ts` — diff logic for account edit
- ✓ Outbox: `update_account`, `reorder_accounts` (no create)
- ✗ Missing: create screen, create outbox kind, create replay logic, liability fields
- ✗ Missing: FF3 POST /v1/accounts call integration

**Files to Touch:** `app/accounts/new.tsx` (new), `src/accounts/accountCreate.ts` (or extend accountEdit.ts), `src/db/schema.ts`, `src/sync/outbox.ts`, `src/sync/payloadJson.ts`, `src/sync/outboxSubjects.ts`, `src/accounts/accountEdit.ts`, `app/settings/accounts.tsx`, i18n, tests

**FF3 Endpoints:** `POST /v1/accounts` (required: name, account_type, account_role, currency_code; optional for liabilities: interest_rate, credit_limit, liability_start_date)

**Blocker Status:** Unblocked (prerequisites exist); blocks liability work in bucket plan's deferred scope.

**Rough Size:** M (screen + form logic + outbox integration)

---

### MISSING: Rules Surface (Rule Groups & Management)
**Requirement (commercialization-and-roadmap.md §2.2):**
- View + toggle Rule Groups (`/v1/rule-groups`)
- View Rules (`/v1/rules`, read from `planned_objects` cache)
- "Create Rule from Transaction" quick action
- Trigger rules (`POST /v1/rules/{id}/trigger`)

**Current State:**
- ✓ Rules cached in `planned_objects` (kind='rule')
- ✗ No dedicated UI (app/rules/* missing)
- ✗ No rule-group surface
- ✗ No "create from transaction" action
- ✗ No outbox kinds for rule save/trigger
- ✗ No trigger logic

**Files to Touch:** `app/rules/list.tsx` (new), `app/rules/detail.tsx` (new), `src/rules/model.ts` (new), `src/rules/actions.ts` (new), `src/rules/replay.ts` (new), `src/db/schema.ts`, `src/sync/outbox.ts`, `src/sync/payloadJson.ts`, `src/sync/outboxSubjects.ts`, app/planned/detail (add "create rule" action), i18n, tests

**Outbox Kinds:** `save_rule` (create/update), `trigger_rule` (manual run)

**FF3 Endpoints:** `GET /v1/rules`, `GET /v1/rule-groups`, `POST /v1/rules`, `PUT /v1/rules/{id}`, `DELETE /v1/rules/{id}`, `POST /v1/rules/{id}/trigger`

**Note:** 22 rule actions in FF3 (set_budget, set_notes, clear_notes, update_piggy, convert_*, switch_accounts, set_amount, etc.); app mirrors `src/planned/ruleBody()` pattern, not just the five actions currently written.

**Blocker Status:** Unblocked (independent of account/insights); low user demand today (trio covers most automation).

**Rough Size:** M–L (list, detail, create, trigger, outbox, replay)

---

### MISSING: Cash Flow & Net Worth Dashboard (Insights)
**Requirement (commercialization-and-roadmap.md §2.4):**
- Monthly cash flow: income vs. expenses (bar/stacked bar chart, or summary cards)
- Net worth trend over time (line chart or monthly cards)
- Opened from Activity tab's app bar button (not a 6th tab)

**Current State:**
- ✓ Activity tab with app bar exists
- ✗ No `app/insights.tsx` screen
- ✗ No `src/insights/` module
- ✗ No chart/visualization components (src/ui/ has no chart primitives)
- ✗ No cash flow calculation
- ✗ No net worth aggregation over time

**Files to Touch:** `app/insights.tsx` (new), `src/insights/cashFlow.ts` (new), `src/insights/netWorth.ts` (new), `src/insights/types.ts` (new), `app/(tabs)/activity.tsx` (add bar button), i18n, tests

**Calculation Logic:**
- Cash flow: aggregate income/expense transactions by period (already available via `GET /v1/transactions?type=income|expense&start&end`)
- Net worth: sum asset/liability account balances over time (already cached in reference_accounts)

**UI Note:** Cashew uses plain Views (no SVG); must work at phone width and in both themes. `dataviz` skill has guidance on chart colors + accessible design. No chart library added yet (react-native-svg rejected in session-dialog).

**Visualization Options:**
1. Custom SVG (small, app already uses plain Views)
2. Styled cards/rows with bars drawn as View widths (matches budget tab style)
3. Summary cards only, numeric tables

**Blocker Status:** Design unresolved (chart library choice); unblocked otherwise.

**Rough Size:** M–L (calculation logic + rendering + theming)

---

### MISSING: Demo / Sandbox Mode
**Requirement (commercialization-and-roadmap.md §2.8):**
- Serve seed data from local SQLite cache (reuse tools/ff3-test/seed.json for realistic fixture)
- Disable outbox (no actual syncs)
- Use for Google Play review (alternative to public demo instance + credentials)

**Current State:**
- ✓ `tools/ff3-test/seed.json` — complete, realistic test data (accounts, categories, bills, transactions)
- ✓ Maestro flows use this seed
- ✗ No app-level demo mode toggle
- ✗ No local-only data serving (always connects to Firefly III)
- ✗ No outbox suppression for demo

**What Exists (Not Suitable):**
- ✓ `app/e2e-sign-in.tsx` — dev build only (`extra.appVariant === 'development'`), deep link sign-in (`mmyway-dev://e2e-sign-in?…`), flows use it; **do not widen** (production would be signable by external link)

**Files to Touch:** Settings toggle for demo mode, `src/db/` to serve seed on demo (or separate demo db), `src/sync/runSync.ts` to skip outbox if demo, i18n, tests

**Blocker Status:** Not blocking v1 release (can use public demo + creds for store review); low priority until store submission.

**Rough Size:** S–M (toggle + sync bypass + seed loading)

---

### PARTIAL: Reminder Lead Time Already Shipped (Configurable)
**Status:** Phase 5 of planned-transactions-plan is DONE. Not missing, included above under "All 5 Phases DONE".

---

## Deferred Items (Marked in Docs)

Listed one per line; not implemented, no files touched.

1. **Piggy-bank creation/deletion** — roadmap §2.3 / plan §5 · belongs with account CRUD · `POST /v1/piggy-banks`, `DELETE /v1/piggy-banks/{id}`
2. **Credit cards / liabilities** — bucket plan §7.5 / plan §5 · FF3 has no credit-payment category; half-model produces unintelligible numbers · asset accounts only in v1 · upgrade path: liabilities field in account create
3. **Non-monthly budget periods** — plan §5 · FF3 supports any start/end; every screen + carry calc doubles · deferred to "when someone budgets weekly"
4. **Per-envelope sweep** — plan §5 · one branch in one function, but needs per-envelope setting + marker · upgrade: `mmyway-sweep: true` in budget notes
5. **True YNAB negative carry** — plan §5 · impossible in `amount > 0` constraint · upgrade: `mmyway-carry: -45.20` in limit notes, subtract on read
6. **Multi-currency envelopes** — plan §5 · budget limit has own currency; mixing in RTA needs rates · deferred to "when second currency is budgeted"
7. **Design B (app as scheduler)** — planned-transactions-plan §4 · app computes occurrences, reminds, triggers on confirm · only works if cron off; users can't turn it off · escape hatch: `GET /api/v1/cron/{cliToken}` addresses case it was meant for
8. **More than five lookahead dates** — planned-transactions-plan §4 · FF3 hardcoded to 5 (9 for daily); no parameter to raise · Phase 3 expander covers cross-transaction agenda
9. **Notification listener / SMS auto-capture** — commercialization-and-roadmap §2.5 · DISCARDED (not deferred) · reasons: open-ended parser maintenance, Play Store SMS/Call Log policy, privacy story, existing gap already covered

---

## Summary Table

| Feature / Phase | Status | Implementation Files | FF3 Endpoints | Notes |
|---|---|---|---|---|
| **YNAB Bucket Budgeting Phase 1** | DONE | `src/bucket/{period,envelopes,funds,rta}.ts`, `app/(tabs)/budget.tsx`, `src/sync/bucketData.ts`, `bucket_objects` table | `GET /v1/budgets?start&end`, `GET /v1/budget-limits?start&end`, `GET /v1/piggy-banks`, `GET /v1/accounts?type=asset` | Commit b71ee85 |
| **YNAB Bucket Budgeting Phase 2** | DONE | `src/bucket/limitWrite.ts`, outbox kind `set_budget_limits`, `src/bucket/replay.ts`, UI sheets | `POST/PUT/DELETE /v1/budgets/{id}/limits` | Commit 47bc686; absolute writes for idempotence |
| **YNAB Bucket Budgeting Phase 3** | DONE | `src/bucket/autofill.ts` | (read-only) | Commit 73d91aa; priority order, no rounding leakage |
| **YNAB Bucket Budgeting Phase 4** | DONE | Outbox kind `set_piggy_amount`, `src/bucket/replay.ts`, conflict check | `PUT /v1/piggy-banks/{id}` with `accounts[]` | Commit 7781293; expectedUpdatedAt for conflicts |
| **YNAB Bucket Budgeting Phase 5** | DONE | `src/bucket/useEnvelopeRemaining.ts`, `app/capture.tsx` | (read-only) | Commit ea34368; real-time display |
| **YNAB Bucket Budgeting Phase 6** | DONE | Budget tab alert row, Phase 2 move sheet | (read-only) | Commit ca6e531; reuses set_budget_limits |
| **Planned Transactions Phase 1** | DONE | `src/api/ff3/auth.ts`, `src/planned/replay.ts`, `src/planned/model.ts` (billBody) | `PUT /v1/recurrences/{id}` | Commit ea34368; delete-and-recreate dance gone |
| **Planned Transactions Phase 2** | DONE | `src/planned/repetition.ts`, `src/planned/model.ts`, `src/planned/labels.ts`, `app/planned/[key].tsx` ScheduleRows, replay intermediate PUT | `PUT /v1/recurrences/{id}` | Commit 8737303; daily, ndom, weekend, multi-rep, end condition |
| **Planned Transactions Phase 3** | DONE | `src/planned/occurrences.ts`, `src/ui/OccurrenceRows.tsx`, `app/planned/[key].tsx` | `GET /v1/recurrences/{id}/transactions` (paginated) | Part of 8737303; expander tests against FF3 occurrences |
| **Planned Transactions Phase 4** | DONE | `src/planned/notes.ts`, `toggleSkipDay()`, `src/sync/recurringReview.ts` | (read-only on write; `notes` via PUT) | Part of 8737303; suppress-on-arrival, marker in notes |
| **Planned Transactions Phase 5** | DONE | `src/settings/appSettings.ts` PLANNED_REMINDER_LEADS, `app/(tabs)/settings.tsx` picker | (read-only) | Part of 8737303; configurable 0–7 days |
| **Account CRUD** | MISSING | — | `POST /v1/accounts` | Size M; prerequisite for liabilities |
| **Rules Surface** | MISSING | — | `POST/PUT/DELETE /v1/rules`, `POST /v1/rules/{id}/trigger`, `GET /v1/rule-groups` | Size M–L; 22 actions |
| **Cash Flow & Net Worth** | MISSING | — | `GET /v1/transactions?type=…`, `GET /v1/accounts?type=…` | Size M–L; chart library choice unresolved |
| **Demo / Sandbox Mode** | MISSING | — | (local only, no new endpoints) | Size S–M; low priority for v1 |
| **Biometric App Lock** | DONE | `src/lock/appLock.ts`, `src/lock/LockGate.tsx` | (local only) | Commit 41b1902 |
| **Homelab TLS & Reverse Proxy** | DONE | `plugins/withUserCaTrust.js`, `src/api/ff3/proxyHeaders.ts` | (transport layer) | Commit 41b1902; private CA + Cloudflare Access headers |
| **Notification Listener / SMS** | DISCARDED | — | — | Commercialization §2.5; intentionally out of scope |

---

## Outbox Kinds Registered

| Kind | Payload | Phase | Status | Files |
|---|---|---|---|---|
| `create_transaction` | TxPayload | Capture | DONE | — |
| `update_transaction` | TxPayload | Capture | DONE | — |
| `delete_transaction` | {txId} | Capture | DONE | — |
| `attach_receipt` | — | Receipts | DONE | — |
| `delete_attachment` | — | Receipts | DONE | — |
| `recurring_review` | — | Planned | DONE | — |
| `update_account` | — | Accounts | DONE | — |
| `reorder_accounts` | — | Accounts | DONE | — |
| `save_planned` | PlannedPayload | Planned | DONE | — |
| `delete_planned` | — | Planned | DONE | — |
| `trigger_planned` | — | Planned | DONE | — |
| `set_budget_limits` | SetBudgetLimitsPayload (entries[]) | Budget Phase 2 | DONE | `src/bucket/replay.ts` |
| `set_piggy_amount` | SetPiggyAmountPayload (piggyId, amount, expectedUpdatedAt) | Budget Phase 4 | DONE | `src/bucket/replay.ts` |
| `create_account` | — | Accounts | MISSING | — |
| `save_rule` | RulePayload | Rules | MISSING | — |
| `trigger_rule` | — | Rules | MISSING | — |

---

## Test Coverage by Module

| Module | Unit Tests | Screen Tests | E2E / Maestro | Status |
|---|---|---|---|---|
| **src/bucket/** | ✓ period, rta, envelopes, funds, limitWrite, autofill, actions, replay | ✓ budget.test.tsx | ✗ no budget/ flows | Comprehensive (unit); E2E coverage TBD |
| **src/planned/** | ✓ repetition, model, labels, occurrences, notes, objects, replay, items, actions | ✓ planned screen (spot checks) | ✓ P1-create-reschedule-delete.yaml | Comprehensive |
| **src/accounts/** | ✓ accountEdit, accountActions | — | ✗ no account creation flows | Missing account create tests |
| **src/rules/** | — | — | — | No module yet |
| **src/insights/** | — | — | — | No module yet |

---

## Verification Checklist

- [x] `npm run check` passes (typecheck + lint + test)
- [x] `npm run analyze` passes (dead code, cycles, import cycles)
- [x] `src/db/migrations.upgrade.test.ts` passes (migration 0014 registered)
- [x] Outbox replay order: manual queue test for `set_budget_limits`, `set_piggy_amount` (subject blocking verified)
- [x] `npm run ff3:test -- fresh` + Maestro flows pass on stock 6.7.7 (fixture and seed in place)
- [x] Budget tab e2e: RTA → assign → move → auto-fill → cover overspent (manual verified per commits)
- [x] Planned tab e2e: daily/ndom repetitions, skip occurrences, reminders (Maestro flows pass)
- [ ] Account creation e2e (blocked on implementation)
- [ ] Rules e2e (blocked on implementation)
- [ ] Insights e2e (blocked on implementation; chart library choice needed)

---

## Recommended Implementation Order (Remaining)

1. **Account CRUD** — smallest scope, unblocked, prerequisite for liability work and piggy creation
2. **Demo / Sandbox mode** — low complexity, needed before Play Store submission
3. **Insights (Cash Flow + Net Worth)** — medium scope, depends on dataviz guidance (chart library choice)
4. **Rules Surface** — medium-large scope, independent, useful for power users (trio covers common automation)

---

## Files & Endpoints Summary by Feature

### Account CRUD (MISSING)
- **Files to create:** `app/accounts/new.tsx`, `src/accounts/accountCreate.ts`
- **Files to modify:** `src/db/schema.ts`, `src/sync/outbox.ts`, `src/sync/payloadJson.ts`, `src/sync/outboxSubjects.ts`, `src/accounts/accountEdit.ts`, `app/settings/accounts.tsx`, i18n, tests
- **FF3 API:** `POST /v1/accounts` (create), `GET /v1/accounts` (read — done)
- **Outbox kind:** `create_account`

### Rules Surface (MISSING)
- **Files to create:** `app/rules/list.tsx`, `app/rules/detail.tsx`, `src/rules/model.ts`, `src/rules/actions.ts`, `src/rules/replay.ts`, i18n, tests
- **Files to modify:** `src/db/schema.ts`, `src/sync/outbox.ts`, `src/sync/payloadJson.ts`, `src/sync/outboxSubjects.ts`, `app/planned/` (add "create rule" action)
- **FF3 API:** `GET /v1/rules`, `GET /v1/rule-groups`, `POST /v1/rules`, `PUT /v1/rules/{id}`, `DELETE /v1/rules/{id}`, `POST /v1/rules/{id}/trigger`
- **Outbox kinds:** `save_rule`, `trigger_rule`

### Cash Flow + Net Worth (MISSING)
- **Files to create:** `app/insights.tsx`, `src/insights/cashFlow.ts`, `src/insights/netWorth.ts`, `src/insights/types.ts`, i18n, tests
- **Files to modify:** `app/(tabs)/activity.tsx` (add bar button)
- **FF3 API:** `GET /v1/transactions?type=…&start&end` (cached), `GET /v1/accounts?type=…` (cached)
- **Chart library:** TBD (custom SVG, styled cards, or charting lib)

### Demo / Sandbox Mode (MISSING)
- **Files to create/modify:** Settings toggle, `src/db/` seed loading, `src/sync/runSync.ts` (bypass outbox if demo), i18n
- **FF3 API:** None (local-only mode)

---

## End Notes

- **Ponytail applied:** Minimal changes identified per feature; no over-engineering of demo mode or charts without requirements.
- **Session dialog follow-up:** The three immediate asks (biometric lock, reverse-proxy headers, account CRUD) have 2/3 done; account CRUD remains the blocker for full coverage.
- **Roadmap alignment:** All six bucket phases and all five planned phases are shipped; commercialization roadmap items 2.1, 2.2, 2.4, 2.8 remain open; items 2.5–2.7 are discarded/done.
