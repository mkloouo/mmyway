# YNAB Bucket Budgeting — Development Plan

Companion to `ynab-bucket-budgeting.md` (the feasibility research). That document asks *can this be
built*; this one says *what to build, in what order, and what each step touches*.

**Target: Firefly III 6.7.7, stock image, no patches.** Every endpoint and validation rule below was
re-read in the `firefly-iii/firefly-iii` v6.7.7 source on 2026-10-11 (file + line given). Nothing
here is from memory or from the research doc's summary.

---

## 0. What the second pass changed

The research doc's §7 rebuild (budgets + budget limits for envelopes, piggy banks for sinking funds,
the trio for bills, RTA derived) **holds**. Five of its specifics do not.

| `ynab-bucket-budgeting.md` says | v6.7.7 actually | Where |
| :--- | :--- | :--- |
| §7.8: bill-update `notes` lacks `nullable` at 6.7.7, merged only to `main`; "base FF3 and clearing a note are mutually exclusive" | **`'notes' => ['nullable', 'min:1', 'max:32768']`.** The fix shipped. The patch is gone (removed from `tools/ff3-test/` in this pass) and `billBody`'s `notes: f.notes \|\| null` works on a stock server | `app/Api/V1/Requests/Models/Bill/UpdateRequest.php` L92 |
| §7.6, §7.10: own the budget limits because "an app-owned budget limit can go below zero" | **It cannot.** `amount` is `['required', new IsValidPositiveAmount()]`, and that rule fails on `lessOrEqualToZero`. A limit's amount is strictly > 0: no zero, no negative | `BudgetLimit/StoreRequest.php` L76, `UpdateRequest.php` L78, `app/Rules/IsValidPositiveAmount.php` |
| §7.1: a piggy bank "cannot exceed its target", `target_amount` required | Required on store, but **`target_amount: 0` means *no target*** and switches both clamps off (`&& 1 === bccomp($targetAmount,'0')`, `&& 0 !== bccomp($piggyBank->target_amount,'0')`). An open-ended sinking fund is expressible | `PiggyBank/StoreRequest.php` L125, `app/Repositories/PiggyBank/ModifiesPiggyBanks.php` L202 |
| §7.7: `set_budget_limit` is "idempotent on replay" | Only after a lookup. **`POST /v1/budgets/{id}/limits` 422s with `limit_exists`** when one already covers that (budget, start, end, currency) — the replay must read, then POST or PUT | `BudgetLimit/StoreRequest.php` L86–127 |
| §7.6: the app must create next period's limit, or FF3's cron will | Neither has to. A period with **no limit** is not broken — it reads as `available = 0 + spent`, i.e. unbudgeted spending, which is exactly right. Limits are created lazily, when the user assigns | — |

Two things the research doc did not mention that the plan depends on:

- **`accounts.*.current_amount` on a piggy update also runs `IsEnoughInAccounts`**: you cannot save
  into a piggy bank more than its linked account actually holds
  (`app/Rules/PiggyBank/IsEnoughInAccounts.php` L42–73). Funding a sinking fund is bounded by real
  money. Good — but the error has to be surfaced, not swallowed.
- **`budget_limit.notes` is `['nullable', 'min:0', 'max:32768']`** — writable *and* clearable with
  `''`. It is the only per-period app-owned storage in the whole model, and the upgrade path for
  anything v1 defers (§6.2). A budget's own `notes` is `['nullable','min:1',…]`: clearable with
  `null`, not with `''`.

And one dead end closed: `auto_budget_amount` cannot be used to park a monthly target while
`auto_budget_type` is `none` — `BudgetRepository` returns before storing anything when the type is
`none` (L585–587).

---

## 1. The model, as it will be built

```
Liquid cash      = Σ reference_accounts.current_balance where type = 'asset' and active
Allocated        = Σ max(0, limit.amount + limit.spent)   over the open period's budget limits
                 + Σ piggy.current_amount
                 + Σ bill.amount_max                      over bills due this period, not yet paid
Ready to Assign  = Liquid cash − Allocated
```

All terms are decimal strings end to end (`AGENTS.md`: FF3 amounts are strings). `limit.spent` is
**negative** as FF3 returns it, so `amount + spent` is the remaining allocation — add, never
subtract. The `max(0, …)` matters: an overspent envelope has already taken the money out of the
account balance, so counting its negative remainder again would inflate RTA by the overspend.

Liabilities are out of scope, as §7.5 recommends, and the Budget screen says so in one line.

| Archetype | FF3 primitive | Funded by | "Available" is |
| :--- | :--- | :--- | :--- |
| Variable envelope | Budget + budget limit for the period | `set_budget_limits` | `limit.amount + limit.spent` |
| Sinking fund / goal | Piggy bank (`target_amount: 0` for open-ended) | `set_piggy_amount` | `current_amount` |
| Fixed obligation | The existing Planned trio | nothing new — read-only roll-up | `paid_dates` vs `pay_dates` |

**Carry-over is always on, and it lives in the amount.** To carry 200 zł of unspent groceries into
November, November's limit amount must be November's assignment *plus* 200. There is nowhere else to
put it: the amount is the only number FF3 adds to `spent`. The consequence has to be stated in the
UI, because it is visible in Firefly III's own budget page: **our `amount` is "available", not
"assigned this month"**, and it compounds across months you underspend. A per-envelope sweep
("leftover goes back to Ready to Assign") is the obvious next knob and is deliberately not in v1 —
it is `max(0, amount + spent)` subtracted instead of added, one branch in one pure function.

---

## 2. Endpoint contract

Everything the app will call, with the shape it will send. All verified in v6.7.7
`routes/api.php` unless noted.

### Reads (one sync pass, inside `pullReferenceData`'s step, see §4.3)

| Call | Why | Notes |
| :--- | :--- | :--- |
| `GET /v1/budgets?start=…&end=…` | budget list + per-budget `spent` for the period | `spent` comes from `BudgetEnrichment` and is **null without `start`/`end`** (`Budget/ShowController@index` L87–88). Already pulled by `src/sync/referenceData.ts` L87 — without the dates |
| `GET /v1/budget-limits?start=…&end=…` | every limit in the window in one paginated call | `DateRangeRequest`: both required. Carries `amount`, `spent`, `period`, `notes`, `start`, `end`, `budget_id`, `updated_at` (`app/Transformers/BudgetLimitTransformer.php` L80–109) |
| `GET /v1/piggy-banks` | sinking funds | `accounts[]`, `current_amount`, `target_amount`, `target_date`, `percentage`, `object_group_title`, `notes`, `updated_at` |
| `GET /v1/accounts?type=asset` | liquid cash | already pulled; `current_balance` already cached in `reference_accounts` |
| bills | fixed obligations | already pulled into `planned_objects` |

Two windows are needed, not one: the open period **and** the one before it, so the "what you had
left last month" suggestion in §3.3 needs no extra round trip.

### Writes

```
# assign / move / auto-fill — one op, N absolute writes
read   GET  /v1/budget-limits?start=S&end=E        (already in cache; re-read on replay)
then   POST /v1/budgets/{id}/limits                { start: S, end: E, amount: A, currency_code: C }
or     PUT  /v1/budgets/{id}/limits/{limitId}      { amount: A }
or     DELETE /v1/budgets/{id}/limits/{limitId}    when A is 0 — `amount: 0` is refused

# fund / spend a sinking fund
PUT /v1/piggy-banks/{id}   { accounts: [{ account_id: X, current_amount: A }] }
```

Use the `accounts[]` form, never the top-level `current_amount`: the top-level field is
`IsValidPositiveAmount` (> 0), so it cannot empty a piggy bank, while `accounts.*.current_amount` is
`IsValidZeroOrMoreAmount(true)` and can (`PiggyBank/UpdateRequest.php` L80, L88). `LessThanPiggyTarget`
is a no-op stub in 6.7.7 (`app/Rules/LessThanPiggyTarget.php`), so the *validator* will not stop an
over-target amount — but `ModifiesPiggyBanks::setCurrentAmount` silently clamps it to the target
(L201–204). Send what fits, or the saved amount will not be what was asked for.

Expected failures to handle by name, not by status code:

| Response | Means | Do |
| :--- | :--- | :--- |
| 422 `limit_exists` on `start` | a limit for this period already exists | re-read, switch to PUT, same op |
| 422 `more_than_zero` on `amount` | we tried to assign 0 | DELETE the limit instead — a bug if it reaches the server |
| 422 `cannot_add_piggy_amount` | the account does not hold that much | surface it: "there is only X in <account>" |
| 422 `invalid_account_currency` | piggy currency ≠ account currency and the account is not multi-currency | surface it; do not retry |
| 422 `current_amount_too_much` (store) | a new piggy's saved amount exceeds its target | only reachable from piggy creation, out of v1 scope |

---

## 3. Modules

New code lives in `src/bucket/` — pure functions, no db, no fetch, mirroring `src/splits/` and
`src/lookup/`. Everything that touches SQLite goes in `src/sync/`, everything that renders goes in
`app/`.

```
src/bucket/
  period.ts        monthly period boundaries: periodOf(day) -> { start, end }, previousPeriod()
  objects.ts       the bucket_objects cache: row <-> typed object, like src/planned/objects.ts
  envelopes.ts     budgets + limits + spent -> Envelope[] (assigned, spent, available, carryIn)
  funds.ts         piggy banks -> Fund[] (saved, target, targetDate, percentage, accountId)
  rta.ts           the §1 formula. Strings in, string out
  autofill.ts      RTA -> a list of (budgetId, amount) in priority order. Pure
  limitWrite.ts    one envelope's wanted amount + the cached limit -> POST | PUT | DELETE | nothing
  useBucket.ts     the screen's query hook (TanStack Query over the cache)
src/sync/
  bucketData.ts    pullBucketData(db, client): the §2 reads -> bucket_objects
app/(tabs)/budget.tsx          the screen
app/budget/[id].tsx            one envelope: history, assign, move
```

`src/bucket/` must not import from `src/planned/` — the fixed-obligations roll-up reads
`planned_objects` through a function in `bucketData.ts`, so the Planned tab and the Budget tab stay
independent and `npm run analyze:cycles` stays clean.

### 3.1 One new table, three kinds

`planned_objects` is the proven pattern for "a cache of FF3 objects, replaced wholesale on each
pull, typed on read" — copy it rather than invent a schema per entity.

```ts
// src/db/schema.ts
export const bucketObjects = sqliteTable('bucket_objects', {
  key: text('key').primaryKey(),           // `${kind}:${ff3Id}` or `${kind}:${ff3Id}:${periodStart}`
  kind: text('kind', { enum: ['budget_limit', 'piggy', 'budget_spent'] }).notNull(),
  ff3Id: text('ff3_id').notNull(),         // budget id for budget_limit/budget_spent
  periodStart: text('period_start'),       // YYYY-MM-DD; null for a piggy
  attributesJson: text('attributes_json').notNull(),
  syncedAt: text('synced_at').notNull(),
});
```

- `budget_limit` — one per (budget, period) that FF3 holds a limit for. Attributes as FF3 sent them.
- `budget_spent` — `{ spent, currency_code }` for a budget with **no** limit in that period, so an
  overspend on an unfunded envelope is still visible.
- `piggy` — one per piggy bank.

`reference_budgets` keeps the name/active list; nothing there changes. Registering the migration in
`src/db/migrations.ts` is mandatory or `src/db/migrations.upgrade.test.ts` fails.

### 3.2 Arithmetic: reuse, don't add

`src/splits/allocate.ts` already does money arithmetic in minor units as `BigInt`
(`toMinor`, `fromMinor`, `sumMinor`, `proportionalShares`, `balance`, `capsFor`). The bucket sums
are the same shape. Import them; do not write a second money layer.

`src/api/ff3/decimal.ts` has `addDecimal`, `trimDecimal`, `isNegative` but **no subtract and no
compare**. Add exactly two, next to `addDecimal`, reusing its private `toMinorUnits`/`fromMinorUnits`:

```ts
export function subtractDecimal(a: string, b: string): string   // RTA, carry
export function compareDecimal(a: string, b: string): -1 | 0 | 1 // "is this overspent"
```

Two functions, ~8 lines, covered by `decimal.test.ts`. Nothing else.

---

## 4. Phases

Each phase is shippable on its own and has a `CHANGELOG.md` line under `[Unreleased]` in the same
commit (`AGENTS.md`). Phase 1 alone is worth having.

### Phase 1 — Read-only Budget tab

**Goal:** see the envelopes, the funds, and Ready to Assign. No writes, so nothing can go wrong in
anyone's ledger.

1. `src/bucket/period.ts` + its test. Monthly only. Period boundaries come from the phone's locale
   calendar via `localDay` (`src/utils/day.ts`), never from `new Date()` arithmetic in UTC.
2. Migration `0014_*` for `bucket_objects`; register in `src/db/migrations.ts`.
3. `src/sync/bucketData.ts`: `pullBucketData(db, client)` doing the §2 reads for the open period and
   the previous one, through `fetchAllPages`, writing the table in **one** `db.transaction` after
   every request has returned — the same "read everything before writing anything" rule as
   `pullPlanned` (`src/planned/objects.ts` L160–183), so a failed request leaves the old cache
   whole rather than half-replaced.
4. Call it from `runSync.ts` right after `pullReferenceData`, in the full-sync path only (it is five
   requests; the quick path must stay quick). Behind the same reachability gate as everything else.
5. `src/bucket/envelopes.ts`, `funds.ts`, `rta.ts` + tests.
6. `app/(tabs)/budget.tsx` — a fifth tab, `Ionicons name="pie-chart"`, between Planned and Settings.
   Built from `Screen`/`AppBar`/`SectionHeader`/`Card`/`Row`/`Money`/`Collapsible`/`EmptyState` in
   `src/ui/components.tsx`. No literal colours; `useTheme()` only. Every string in
   `src/i18n/locales/en.json` plus the same key, empty, in `uk-UA.json` (`docs/LOCALIZATION.md`).
7. One honest line on the screen: Firefly III's own "left to budget" is a different number, because
   `/v1/available-budgets`' write routes are commented out upstream (`routes/api.php` L413–416) and
   nothing can maintain the record it is based on. Say it where it is read, not in a FAQ.

**Tests:** `period.test.ts`, `rta.test.ts` (including the overspent-envelope `max(0, …)` case and a
currency with 0 decimal places), `envelopes.test.ts` (limit present / absent / overspent),
`src/__screens__/budget.test.tsx` (renders from a seeded `bucket_objects`, shows RTA, shows an
overspent envelope). Screen tests live in `src/__screens__/`, never under `app/`.

**Risk:** none to FF3 — read-only.

### Phase 2 — Assign

**Goal:** move money from Ready to Assign into an envelope, and between envelopes.

1. `src/bucket/limitWrite.ts` — pure: `(wanted, cachedLimit) -> { method: 'POST'|'PUT'|'DELETE'|'none', … }`.
   This is where "amount must be > 0 so zero means DELETE" and "`limit_exists` means switch to PUT"
   live, and where they are tested.
2. New outbox kind **`set_budget_limits`** (plural, on purpose):

```ts
interface SetBudgetLimitsPayload {
  periodStart: string;            // YYYY-MM-DD
  periodEnd: string;
  currencyCode: string;
  // Absolute wanted amounts. One entry = assign; two = move; many = auto-fill.
  entries: { budgetId: string; amount: string; limitId?: string | null }[];
}
```

   One op kind covers assign, move and auto-fill. The reason it is plural is correctness, not
   convenience: *"move 50 from Dining Out to Groceries" must not be two queued operations* — if the
   decrement lands and the increment fails, money disappears from the budget. One op, both writes,
   and because every entry is **absolute**, a retry after a lost answer re-sends all of them and
   converges. `limitId` is recorded into the payload as each entry lands (`writePayload`, exactly as
   `replaySavePlanned` records `billId`), so a retry PUTs instead of POSTing.
3. Register in `src/db/schema.ts`'s `outboxOperations.kind` enum, `OutboxKind`, the `SCHEMAS` map in
   `src/sync/payloadJson.ts`, and `subjectsOf` in `src/sync/outboxSubjects.ts` — **every** budget in
   `entries` as a `budget:<id>` subject, so a second assignment to the same envelope queues behind
   the first instead of racing it. It is **not** a `LEDGER_KIND`: a budget limit does not move an
   account balance.
4. `src/bucket/replay.ts` — `replaySetBudgetLimits(db, client, opId, payload)`. Per entry: resolve
   the limit id (payload → cache → a fresh `GET /v1/budgets/{id}/limits?start&end`), then the
   `limitWrite.ts` verdict, then `storeBucketObject` with what FF3 answered, so the screen updates
   without waiting for the next sync.
5. UI: an assign sheet reusing `AmountSheet`/`Keypad`, and a move sheet reusing `AllocationSheet` +
   `Slider` — the sliders already exist for splits and the interaction is the same "this much here,
   the rest there".
6. The `useAction()` wrapper for both handlers; the table write lives in `src/`, not in the screen.

**Tests:** `limitWrite.test.ts` (new limit, existing limit, zero → DELETE, unchanged → none);
a replay test in the style of `src/sync/outbox.regressions.test.ts` for **the lost-answer case** —
replay an op whose POST already landed, assert one limit with the right amount and no 422 bubbling
up; a move test asserting both writes go out under one op.

**Risk:** this is the first phase that writes. The mitigation is that every write is absolute and
every op is one transaction's worth of intent. Verify on `npm run ff3:test -- fresh` before it ships.

### Phase 3 — Auto-Fill

Pure function, one new UI button, no new op kind.

`src/bucket/autofill.ts`: RTA plus the period's state in, a `SetBudgetLimitsPayload['entries']` out,
in the research doc's priority order:

1. bills due in the open period that are not yet funded (the trio's `amount_max`);
2. envelopes up to **last period's assigned amount** (the "do what I did last month" default);
3. sinking funds, by `(target_amount − current_amount) / months until target_date`;
4. whatever is left stays in Ready to Assign.

No stored per-envelope target in v1 — last period's amount is the target, which is free and needs no
new field. When one is wanted later, the budget's own `notes` is the place (`['nullable','min:1',…]`,
clearable with `null`), as `mmyway-target: 700.00`, following the `mmyway-time:` precedent in
`src/planned/plannedTime.ts`.

**Tests:** exhausts RTA exactly and never over-assigns by a rounding unit (allocate in minor units
via `src/splits/allocate.ts`); respects the order; an RTA of 0 produces no entries; a negative RTA
produces no entries and no crash.

### Phase 4 — Sinking funds

New op kind `set_piggy_amount`:

```ts
interface SetPiggyAmountPayload {
  piggyId: string;
  accountId: string;
  amount: string;                  // absolute accounts[].current_amount
  expectedUpdatedAt?: string;       // the piggy's updated_at when the edit started
}
```

Absolute, so a replay converges — but it is a read-modify-write against a field Firefly III's own
web UI can also change, so the conflict check matters. `PiggyBankTransformer` returns `updated_at`
(L62); compare it the way `recurringReview.ts` compares a journal's, and fail the op with a readable
message instead of overwriting. Subject: `piggy:<id>`.

The `cannot_add_piggy_amount` and `invalid_account_currency` 422s are user-facing messages, not retries.

Creating piggy banks is out of scope here — it belongs with the account/piggy CRUD in
`commercialization-and-roadmap.md` §2.3.

### Phase 5 — Capture integration

In `app/capture.tsx`, when a category or budget is chosen, show that envelope's remaining next to it
(`Groceries · 420,00 zł left`). One read from `bucket_objects`, no new network, no new writes. This
is the phase that makes the rest of it felt daily, and it is the cheapest of the five.

### Phase 6 — Cover overspending

An envelope whose `amount + spent` is negative gets an alert row; tapping it opens the Phase 2 move
sheet pre-filled with the shortfall and a list of envelopes that have it to give. No new primitive —
it is Phase 2's op with a suggested amount.

---

## 5. What is deliberately not in v1

Each of these is a line someone will ask about; the answer is the cost, not the taste.

| Not doing | Why | When to add |
| :--- | :--- | :--- |
| Non-monthly periods | FF3's limits take any `start`/`end`, so the model allows it, but every screen and the whole carry computation doubles | when someone budgets weekly |
| Per-envelope sweep instead of carry | one branch in one pure function, but a per-envelope setting, a migration and a marker to store it in | when the compounding `amount` in FF3's web UI becomes annoying |
| True YNAB negative carry | impossible in `amount` (> 0). The upgrade path is `mmyway-carry: -45.20` in the limit's `notes` and subtracting it on read | if forgiving an overspend at month end turns out to be wrong |
| Credit cards / liabilities | §7.5: FF3 has no credit-card-payment category, and half-modelling it yields a number nobody can debug | never, probably |
| Piggy-bank creation and deletion | roadmap §2.3's CRUD, not this feature | with account CRUD |
| Multi-currency envelopes | a budget limit carries its own currency; mixing them in one RTA needs rates | when a second currency is actually budgeted |
| Rule-driven envelope deduction | no `remove_from_piggy_bank` action exists (`config/firefly.php` L432–465 — `update_piggy` only, direction inferred from the transaction's accounts). Budgets need no rule at all: a transaction's `budget_id` *is* the envelope | never — this was the research doc's wrong turn |

---

## 6. Settle on the test instance before Phase 2

`npm run ff3:test -- fresh` (now stock 6.7.7, no patches). Each of these is an inference from
reading the source, not an observation:

1. **Does `GET /v1/budget-limits?start&end` return a limit that only partly overlaps the window?**
   `getAllBudgetLimits` is a repository call behind `DateRangeRequest`; the overlap rule decides
   whether the app must filter by exact `start`/`end` after reading. Assume it must until checked.
2. **Is `limit.spent` scoped to the limit's own period or to the query window?** The transformer
   reads `$budgetLimit->meta['spent']` from `BudgetLimitEnrichment`; which dates that enrichment
   uses determines whether the two-window read in §4.3 is correct or double-counts.
3. **Does a limit created with no `period` behave like one the auto-budget cron made?** `period` is
   in the transformer but not in either request's `rules()`, so an app-created limit has a null
   `period`. Confirm FF3's budget page renders it.
4. **Does `PUT /v1/piggy-banks/{id}` with `accounts[].current_amount: "0"` empty the piggy bank?**
   `IsValidZeroOrMoreAmount(true)` says yes; `setCurrentAmount`'s event path for a negative
   difference should fire. This is the only way to zero a fund, so it must be certain.
5. **Does assigning to a budget whose currency differs from the account's break the sum?** Decides
   whether the "multi-currency envelopes" row in §5 is a deferral or a guard.

Per `AGENTS.md`, anything found and not fixed becomes a GitHub issue in `mkloouo/mmyway`, and the PR
that closes one says `Fixes #N`.

---

## 7. Minimum Firefly III version

Nothing in this plan needs more than **6.3.2**, the app's current floor
(`src/api/ff3/auth.ts` `MIN_API_VERSION`; `/api/v1/about` returns the app version in `api_version`,
`AboutController` L55, so it really is an app-version floor). Budget limits, piggy-bank
`accounts[]`, and per-budget `spent` all predate it.

But `planned-transactions-plan.md` raises the floor to **6.7.0** for the recurrence `moment`
validation fix, and that is the floor to build both features against. Raising it costs this feature
nothing and is worth doing once.
