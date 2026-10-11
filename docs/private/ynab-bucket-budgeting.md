# YNAB-Style Zero-Based Bucket Budgeting on Firefly III

## 1. Executive Summary

Firefly III is built around double-entry accounting rather than envelope budgeting. Native Firefly III budgets (`/v1/budgets`) represent spending caps on categories, rather than cash-holding envelopes with rollover reserves and unassigned cash tracking.

However, by unifying four existing Firefly III primitives—**Subscriptions (Bills)**, **Piggy Banks**, **Rules**, and **Recurring Transactions**—we can create a 100% native, zero-based YNAB-style bucket budgeting system.

---

## 2. The Four Primitives & Their YNAB Mapping

| YNAB Concept | Firefly III Primitive | Role in the Bucket Engine |
| :--- | :--- | :--- |
| **Fixed Monthly Bills** (Rent, Netflix, Utilities) | **Bills + Recurrences + Rules** ("The Planned Trio") | Tracks billing cycles, due dates, paid status, and expected amounts. Auto-matches transactions via rules. |
| **Sinking Funds & Savings Goals** (Vacation, Car Repairs) | **Piggy Banks** (`/v1/piggy-banks`) | Holds cash reserves; naturally preserves balance across month boundaries; defines targets and monthly savings pace. |
| **Variable Spending Envelopes** (Groceries, Dining Out) | **Envelope Piggy Banks + Auto-Deduct Rules** | Tracks spendable cash envelope balances. Rules deduct transaction amounts from the envelope upon capture. |
| **Automated Spending Deduction** | **Rules** (`/v1/rules`) | Uses native `remove_from_piggy_bank` and `link_to_bill` actions to route transactions to the proper bucket automatically. |

---

## 3. Mathematical Model: Ready to Assign (RTA)

In zero-based budgeting, every dollar of liquid cash is assigned to a specific job until unassigned funds reach zero:

$$\text{Total Liquid Cash} = \sum \text{Active Asset Accounts} - \text{Credit Card Debt}$$

$$\text{Allocated to Buckets} = \sum \text{Piggy Bank Balances} + \sum \text{Funded Pending Bills for Cycle}$$

$$\mathbf{Ready\;to\;Assign\;(RTA)} = \mathbf{Total\;Liquid\;Cash} - \mathbf{Allocated\;to\;Buckets}$$

### Inflow (Paycheck Event)
1. A deposit lands in an asset account.
2. `Total Liquid Cash` increases $\to$ `Ready to Assign` increases.
3. The UI presents an **"Assign Funds"** banner.

---

## 4. The Three Bucket Archetypes

### Archetype 1: Fixed Obligations (Bills & Subscriptions)
* **Underlying FF3 Entities:** `Bill` + `Recurring Transaction` + `Rule`.
* **Behavior:**
  - Cycle start: Flagged as *Underfunded* with due date and target amount.
  - User Action: Assigns amount from RTA $\to$ Marked *Funded*.
  - Execution: When transaction fires (via cron or manual capture), the FF3 Rule matches payee and links it to the Bill $\to$ Marked *Paid* for the period.

### Archetype 2: Sinking Funds / Long-Term Goals
* **Underlying FF3 Entities:** `Piggy Bank` with `target_amount` and `target_date`.
* **Behavior:**
  - Funding: Adding money from RTA posts an event (`POST /v1/piggy-banks/{id}/events` with `action: add_amount`).
  - Rollover: Handled natively by Firefly III—funds stay in the Piggy Bank indefinitely.
  - Spending: When a transaction occurs (e.g. paying an auto repair shop), a Rule matching the tag or payee executes action `remove_from_piggy_bank` for the spent amount.

### Archetype 3: Variable Spending Envelopes
* **Underlying FF3 Entities:** Dedicated Piggy Bank (e.g. `[Env] Groceries`) + Auto-Deduct Rule.
* **Behavior:**
  - Setup: A Piggy Bank is created to represent the envelope's available balance.
  - Rule: `If Category == Groceries AND Type == withdrawal`, trigger `remove_from_piggy_bank: "[Env] Groceries"`.
  - Display:
    - *Budget Target*: $500.00
    - *Available*: Piggy Bank `current_amount`
    - *Spent*: Calculated from category spending in current period.
  - Month-End Rollover:
    - *Option A (Rollover):* Leftover balance remains in the Piggy Bank for next month.
    - *Option B (Sweep):* At the start of the new month, unspent balance is swept back to RTA via `remove_amount` event.

---

## 5. Mobile Workflow & UX

```
┌────────────────────────────────────────────────────────┐
│  Ready to Assign: 340,00 zł               [ Auto-Fill ]│
├────────────────────────────────────────────────────────┤
│ ▼ FIXED OBLIGATIONS (3/3 funded)                       │
│   • Rent                    1 800,00 zł / 1 800,00 zł  │  (Bill + Recurrence)
│   • Netflix                    49,00 zł /    49,00 zł  │
│                                                        │
│ ▼ VARIABLE SPENDING                                    │
│   • Groceries                 420,00 zł remaining      │  (Envelope Piggy Bank)
│     [████████████░░░░░] 60% of 700 zł                  │
│   • Dining Out                 35,00 zł remaining ⚠️   │
│                                                        │
│ ▼ SINKING FUNDS                                        │
│   • Vacation Fund           1 200,00 zł / 3 000,00 zł  │  (Piggy Bank Goal)
│     [██████░░░░░░░░░░░] 40% · Target: Jul 2027         │
└────────────────────────────────────────────────────────┘
```

### Micro-Interactions:
* **Auto-Fill:** Distributes RTA in strict priority order:
  1. Upcoming bills due in the current period.
  2. Variable envelopes up to monthly targets.
  3. Sinking funds according to `save_per_month`.
  4. Surplus remains in RTA.
* **Cover Overspending:** When an envelope goes negative, tapping the alert prompts to reallocate funds from another envelope (executing an atomic transfer between piggy banks).
* **Capture Integration:** When capturing a transaction in `app/capture.tsx`, selecting a payee or category displays live bucket availability (e.g., `Groceries (420,00 zł remaining)`).

---

## 6. Compatibility & Architecture

* **Zero Backend Modifications:** Operates entirely over standard Firefly III v1 REST endpoints (`/v1/bills`, `/v1/piggy-banks`, `/v1/rules`, `/v1/recurring-transactions`).
* **Web UI Consistency:** All transactions, piggy banks, and bills appear natively in Firefly III's web interface without custom metadata corruption.
* **Offline Synchronization:** Bucket adjustments map to standard queued operations in `src/sync/outbox.ts` (`adjust_piggy_bank`, `save_planned`), retaining full offline support.

---

## 7. Review of §1–§6 against the Firefly III source (2026-10-09)

Everything below was checked against `firefly-iii/firefly-iii` at tag `v6.7.7` — the current
release, published 2026-10-03 — and at `main`. Nothing here is from memory. Where a claim in
§1–§6 does not hold, the correction names the file it was checked in.

The verdict up front: **the plan is sound, two of its three archetypes are built on the wrong
primitive, and the one primitive it never mentions is the one Firefly III actually ships for
envelope budgeting.** Rebuilt on budgets + budget limits, the whole thing still needs zero
backend.

### 7.1 Corrections

| §1–§6 claim | Reality | Checked in |
| :--- | :--- | :--- |
| Rule action `remove_from_piggy_bank` (§2, §4 Archetype 2/3) | **Does not exist.** The only piggy-bank rule action is `update_piggy`. There are 22 actions and exactly one touches piggy banks. | `config/firefly.php` → `rule-actions`; `app/TransactionRules/Actions/UpdatePiggyBank.php` |
| That action can be told to remove | **It has no direction parameter.** Direction is inferred: if the piggy's account is the transaction's *source* it removes, if the *destination* it adds, if both or neither it fails and does nothing. | `UpdatePiggyBank.php` |
| `POST /v1/piggy-banks/{id}/events` with `action: add_amount` (§4 Archetype 2, §6) | **No such route.** Only `GET {piggyBank}/events` exists. Saved amounts change via `PUT /v1/piggy-banks/{id}` carrying the whole `accounts[]` array with absolute `current_amount` per account. | `routes/api.php` L497–513 |
| An envelope piggy bank tracks "available", including overspend (§4 Archetype 3) | **A piggy bank cannot go negative and cannot exceed its target.** `accounts.*.current_amount` is validated by `IsValidZeroOrMoreAmount`; a `withValidator` pass rejects the sum exceeding `target_amount` with `current_amount_too_much`; `UpdatePiggyBank` clamps both directions itself. `target_amount` is `required`. | `app/Api/V1/Requests/Models/PiggyBank/StoreRequest.php` L71–126 |
| Piggy banks hang off one account | Multi-account since 6.2: `accounts[].account_id` + `accounts[].current_amount`, asset and liability accounts only. | same file, L52–120 |
| "Zero Backend Modifications" (§6) | **False today**, see §7.8. | `tools/ff3-test/patches/` |

The piggy-bank clamp is the one that matters. YNAB's envelope has to be able to go negative —
"Cover Overspending" in §5 is an interaction that only exists because the number went below
zero — and it has to be able to hold more than one month's target when you underspend. A
Firefly III piggy bank can do neither. **Archetype 3 as written cannot be built.**

### 7.2 What §2 missed: Firefly III already has rollover envelopes

Native budgets are not just "spending caps on categories" (§1). They carry an auto-budget:

```
auto_budget_type   in: reset, rollover, adjusted, none
auto_budget_amount required when type is not none
auto_budget_period
```

— `app/Api/V1/Requests/Models/Budget/StoreRequest.php` L84–98.

And budget *limits* are per-period allocations, fully writable:

```
GET    /v1/budgets/{id}/limits
POST   /v1/budgets/{id}/limits
PUT    /v1/budgets/{id}/limits/{limitId}
DELETE /v1/budgets/{id}/limits/{limitId}
```

— `routes/api.php` L438–444. Each limit carries `start`, `end`, `amount`, `period`, a
server-computed **`spent`**, and its own **`notes`** field
(`app/Transformers/BudgetLimitTransformer.php` L81–109). `/v1/budgets` returns `spent` per
budget too.

`rollover` does what the name says. In `app/Jobs/CreateAutoBudgetLimits::createRollover()`:

```php
// if you spent more in previous budget period than whatever you had, the amount resets
$budgetLeft = bcadd($budgetLimit->amount, $spentAmount);   // $spentAmount is negative
```

So the new period's allocation is *last period's unspent remainder plus this period's amount*,
and if you overspent it resets to this period's amount alone — rollover with the negative carry
clamped at zero.

That is Archetype 3, natively: Firefly III does the `spent` arithmetic, Firefly III does the
rollover, it shows up on Firefly III's own budget page, it needs no rule per envelope, and there
is no piggy-bank clamp in sight.

### 7.3 Revised primitive mapping

| Archetype | Use | Why |
| :--- | :--- | :--- |
| Fixed obligations | Bills + recurrences + rules — the existing trio | Already built; `paid_dates` / `next_expected_match` give paid-vs-due for free |
| **Variable envelopes** | **Budgets + budget limits** | Native `spent`, native rollover, writable allocations, no clamp, visible in FF3 web |
| Sinking funds / goals | Piggy banks | What they natively are: a target, a target date, a saved amount that persists |

Three archetypes, three primitives, each used for the thing it already is. Rules stay in the
picture only for the trio's `link_to_bill`, which is what they are there for today.

One consequence worth stating: this ties envelopes to **categories via budgets**, which is how
Firefly III thinks. A transaction gets a `budget_id` (the app already writes one —
`src/api/ff3/types.ts` `TransactionSplit.budget_id`), and that is the envelope it spends from.
No rule, no tag, no piggy.

### 7.4 Ready to Assign cannot be stored in Firefly III

`routes/api.php` L404–418:

```php
Route::get('', ['uses' => 'ShowController@index', 'as' => 'index']);
// Route::post('', ['uses' => 'StoreController@store', 'as' => 'store']);
// Route::put('{availableBudget}', ...);
// Route::delete('{availableBudget}', ...);
```

`/v1/available-budgets` is **read-only** — the write routes are commented out upstream. So RTA
has to be derived and held by mmyway. That is fine in itself (YNAB derives it too), but be
honest about the consequence: **mmyway's "Ready to Assign" and Firefly III's own "left to
budget" on the web budget page will be different numbers**, because FF3's is based on an
available-budget record nothing can write any more. That is the single place the two UIs
disagree, and it should be said in the UI, not discovered.

### 7.5 Revised RTA model

The §3 formula needs two fixes — the piggy-event basis is gone, and the credit-card term is
wrong for Firefly III.

```
Liquid cash      = Σ current_balance of active asset accounts        (/v1/accounts?type=asset)
Allocated        = Σ unspent budget-limit amounts for the open period   (limit.amount + limit.spent)
                 + Σ piggy-bank current_amount
                 + Σ funded-but-unpaid bill amounts for the cycle
Ready to Assign  = Liquid cash − Allocated
```

All of those arrive as strings. They go through `src/api/ff3/decimal.ts`, never `Number` —
`AGENTS.md` rule, and it is the rule most likely to be broken by a formula written out as maths.

On `− Credit Card Debt` (§3): in Firefly III a credit card is a **liability account** whose
balance is already negative, so subtracting it again double-counts. More importantly, YNAB's
credit handling works because of the credit-card payment *category* that fills as you spend on
the card, and Firefly III has no analogue. Half-modelling it will produce a number that is
wrong in a way users cannot debug. **Recommendation: liabilities are out of scope for v1**,
asset accounts only, stated plainly on the screen.

### 7.6 Who creates next period's allocation

Auto-budget rollover runs in Firefly III's cron (`AutoBudgetCronjob` → `CreateAutoBudgetLimits`),
only on the period's boundary day, and only if the new period's limit does not exist yet. That
is the same cron dependency the Planned tab already carries, and a self-hoster whose cron is not
wired up gets no rollover at all — silently.

The app can create the limit itself: `POST /v1/budgets/{id}/limits` with the carry-over it
computed. If it does, the budget must be `auto_budget_type: none`, or both will try.

**Recommendation: the app owns budget limits (`auto_budget_type: none`).** It removes a
deployment dependency, and it makes the carry-over rule ours — which is the only way to get
YNAB's *negative* carry, since FF3's own rollover floors it at zero. FF3's budget page then
shows our numbers, which is the point.

### 7.7 Outbox shapes

§6 proposes `adjust_piggy_bank`. That is the one shape to avoid: an additive operation
double-counts when the outbox replays it after a lost response, and `src/sync/outbox.ts` retries
on exactly that case. Both writes available to us are absolute, so use them as such:

- `set_budget_limit` — budget + period + absolute amount. Idempotent on replay.
- `set_piggy_amount` — piggy + absolute `current_amount` per account. Idempotent on replay, but
  read-modify-write with no `updated_at` to check against, so a concurrent change from FF3's web
  UI or a second device is silently lost. Worth a conflict check of the kind
  `recurringReview.ts` already does with `expectedUpdatedAt`.

"Move money from Dining Out to Groceries" is **two** budget-limit writes. It must be one outbox
operation that performs both, not two queued operations — if the decrement lands and the
increment fails, money has disappeared from the budget. Register both budgets as subjects in
`src/sync/outboxSubjects.ts` so dependents are held back.

### 7.8 §6's "Zero Backend Modifications" is false today

`tools/ff3-test/patches/patches.json` says it, and so does the comment in
`src/planned/model.ts` `billBody()`: the production server runs a patched
`app/Api/V1/Requests/Models/Bill/UpdateRequest.php` so that a bill update can send
`notes: null`.

Status of that patch upstream, checked tag by tag:

| | `notes` rule on bill update |
| :--- | :--- |
| v6.2.10 | `'min:1\|max:32768'` |
| v6.7.6 | `['min:1', 'max:32768']` |
| **v6.7.7** (current release) | `['min:1', 'max:32768']` |
| `main` | `['nullable', 'min:1', 'max:32768']` |

So the fix is merged but **unreleased**. Until it ships, "base Firefly III" and "clear a planned
transaction's note" are mutually exclusive.

The obvious workaround does not work: sending `" "` to satisfy `min:1` fails, because Laravel's
`TrimStrings` is in Firefly III's global middleware stack (`bootstrap/app.php` L85), so the
space arrives as `""`. A non-whitespace placeholder (`"—"`) would pass, and would be visible in
FF3's web UI forever. See `planned-transactions.md` §5 for the call.

### 7.9 Do we need our own backend? No.

Taking the question seriously, since it is the expensive decision in this document.

Nothing in the bucket engine needs one. Every write it depends on is a base-FF3 endpoint that
exists and is writable today: budgets, budget limits, piggy banks, bills, recurrences, rules.
The three things that looked like they might need a server do not:

1. **RTA is not storable in FF3** (§7.4) — so derive it. YNAB derives it too. No server.
2. **Envelopes need a negative balance** — so own the budget limits (§7.6) instead of asking
   FF3's rollover for it. No server.
3. **App-only state has nowhere to live** — it does. Firefly III's `notes` fields are writable
   on bills, budgets, budget limits, piggy banks and recurrences, and this repo already has the
   precedent: `src/planned/plannedTime.ts` keeps a planned time of day as a `mmyway-time: 09:30`
   marker in a recurrence's notes. One more marker is cheaper than one more service.

What a backend would actually buy is cross-device sync of app-only state and push
notifications. For a single-user self-hoster — who by definition already runs a server, and
whose phone can schedule its own local notifications — neither is worth owning.

And it cuts against the business model directly. `commercialization-and-roadmap.md` §2.9 already
rejects a hosted LLM proxy on the grounds that recurring cost beats one-time revenue; a
state-holding backend is that argument with worse margins and added liability — now it is the
user's financial data on our box, under GDPR, needing backups, an incident process and an exit
path for every customer who stops paying. It would also break the clean AGPL story in §1.2,
which holds precisely *because* nothing of ours sits between the app and their Firefly III.

**Recommendation: no backend. Keep the product a client.** If something genuinely cannot live in
Firefly III later, the next cheapest step is a marker in a `notes` field, then a file in the
user's own storage — not a service we operate.

### 7.10 What this changes in §1–§6

- §2: replace the "Variable Spending Envelopes" row — budgets + budget limits, not piggy banks
  and rules.
- §3: use the §7.5 formula; drop the credit-card term.
- §4 Archetype 3: rewrite entirely. No `[Env] …` piggy banks, no auto-deduct rule. An envelope
  is a budget; funding it is a budget-limit write; "Available" is `limit.amount + limit.spent`;
  rollover vs sweep is whether we carry the remainder into the next limit.
- §4 Archetype 2: funding a sinking fund is `PUT /v1/piggy-banks/{id}`, not an event POST.
- §5 Auto-Fill: unchanged as a priority order; its writes are budget-limit writes.
- §5 Cover Overspending: now possible, because an app-owned budget limit can go below zero.
- §6: drop "Zero Backend Modifications" until §7.8 clears, and replace `adjust_piggy_bank` with
  the absolute operations in §7.7.

### 7.11 Minimum Firefly III version

Worth deciding here because it also decides a Planned question. The app's floor is **6.3.2**
(`src/api/ff3/auth.ts` `MIN_API_VERSION`; FF3's `/api/v1/about` returns the app version in the
`api_version` field — `AboutController` L55 — so this really is an app-version floor).

Everything in this document works at 6.3.2 except the unreleased bill-notes `nullable`. But
`planned-transactions.md` §5 wants a floor of **6.7.0** for an unrelated reason, and raising it
costs nothing here.
