# Planned Transactions: Wallet-Grade Scheduling on Base Firefly III

Companion to `ynab-bucket-budgeting.md`. That document is about where money is *assigned*; this
one is about the things that are *scheduled*. Target: **base Firefly III, no patches** (see §5
for what that costs).

Checked against `firefly-iii/firefly-iii` at `v6.7.7` (current release, 2026-10-03) and at
`main`. Firefly III source references are file + line at `v6.7.7`.

---

## 1. Why the current Planned tab feels thin

It is not the screens. It is that `src/planned/model.ts` models a far smaller schedule than
Firefly III can hold, and the loss is invisible.

### 1.1 The schedule model throws most of FF3's expressiveness away

Firefly III's recurrence repetition takes:

| Field | Values | Exposed today |
| :--- | :--- | :--- |
| `type` | `daily`, `weekly`, `ndom`, `monthly`, `yearly` | `weekly`, `monthly`, `yearly` |
| `moment` | weekday 1–7 / day-of-month 1–31 / `"nth,weekday"` for `ndom` / `Y-m-d` | derived from the date, never chosen |
| `skip` | 0–31 (every N periods) | yes, as "every N" |
| `weekend` | 1 do nothing · 2 skip · 3 move to Friday · 4 move to Monday | **no — hardcoded `weekend: 1`** |
| *the array itself* | **a recurrence may hold many repetitions** | **no — `repetitions[0]` only** |

— `app/Api/V1/Requests/Models/Recurrence/UpdateRequest.php` L100,
`app/Validation/RecurrenceValidation.php` (`validateRepetitionMoment`),
`app/Enums/RecurrenceRepetitionWeekend.php` L32–35.

`model.ts` flattens all of it into five presets plus "every N":
`'weekly' | 'monthly' | 'quarterly' | 'half-year' | 'yearly'`. `daily` and `ndom` have no
representation at all. Nothing can say "the second Tuesday of the month", "skip it if it falls
on a weekend", or "the 1st and the 15th" — and those are exactly the Wallet by BudgetBakers
affordances that make its planned payments feel tuneable.

### 1.2 Two real bugs fall out of that, not just gaps

**Editing the schedule of a multi-repetition recurrence destroys the extra repetitions.**
`recurrenceBody()` sends `repetitions: [one]`. Firefly III's updater:

```php
// app/Services/Internal/Update/RecurrenceUpdateService.php L269–281
// user added or removed repetitions, delete all and recreate:
if ($originalCount !== count($repetitions)) {
    $this->deleteRepetitions($recurrence);
    $this->createRepetitions($recurrence, $repetitions);
}
```

So a "1st and 15th" recurrence built in Firefly III's web UI, opened in the simple view and
saved with any schedule change, comes back as "1st" only. Silently. (A non-schedule edit is
safe — `recurrenceBody` only sends `repetitions` when `scheduleChanged()`.) **File as an
issue.**

**A `daily` or `ndom` recurrence is misread and then rewritten as monthly.**
`frequencyFromRepetition()` has branches for `weekly` and `yearly` and returns `monthly` for
everything else. A daily recurrence displays as "every 1 month"; an `ndom` recurrence loses its
`"2,1"` moment. Save, and that is what Firefly III now holds. **Same issue.**

Lesser, but it is the exact texture of "fine-tuning doesn't stick": quarterly and half-year are
written as `monthly` with `skip: 3n−1` / `6n−1`, and read back as "every 3 months" / "every 6
months". The label the user picked does not survive a round trip.

### 1.3 The confirm order is inverted

`AGENTS.md`: *"Confirm is mandatory. No code path may push a create/edit/delete to the outbox
without the inbox item having passed through the `confirmed` state."*

For planned transactions that is honoured only retroactively. Firefly III's cron books the
transaction, `pullUnreviewedRecurring()` finds it (journal has `recurrence_id`, no
`mmyway-reviewed` tag), and the user approves a transaction that is **already in the ledger**.
Every intervention is a correction after the fact. That is the root of why per-occurrence
control feels impossible: there is no moment before the write at which to intervene.

### 1.4 Three things simply are not there

- **No occurrence list.** Firefly III hands over the next five dates per repetition and the app
  reads `occurrences[0]`, for the "Next …" line. Past occurrences have a native endpoint the
  app never calls.
- **No reminders.** `expo-notifications` is not a dependency. `fields.time` exists, but it only
  re-stamps the booked transaction's time afterwards (`plannedTime.ts`, `recurringReview.ts`).
- **No way to skip one occurrence** before it happens. Only to delete it after, from the Inbox
  card.

---

## 2. What base Firefly III actually gives us

More than §1 suggests. Verified, all on the app's existing API floor unless noted.

| Thing | Where | Good for |
| :--- | :--- | :--- |
| 5 future dates per repetition (9 if daily), from `latest_date ?? first_date` | `repetitions[].occurrences`, built in `app/Support/JsonApi/Enrichments/RecurringEnrichment.php` L364–366 | the "next few" list, free |
| Localised repetition description | same, `repetitions[].description` | a schedule label we do not have to compose |
| Past occurrences of a recurrence | `GET /v1/recurrences/{id}/transactions` (`routes/api.php` L532) | the history half of the list |
| Book one specific date, idempotently | `POST /v1/recurrences/{id}/trigger?date=…` (L528) | already used by "book now" (#44) |
| Per-occurrence "already booked" marker | `journal_meta` rows `recurrence_id` + `recurrence_date`, read by `RecurringRepository::createdPreviously()` L71–91; plus `recurrences.latest_date`, which only moves forward | why a trigger never double-books |
| Bill paid/due state | `paid_dates`, `pay_dates`, `next_expected_match` (`app/Transformers/BillTransformer.php` L95–98) | fixed obligations, free; the app reads only `next_expected_match` |
| Run FF3's scheduler on demand | `GET /api/v1/cron/{cliToken}` (`routes/api.php` L51) | a "catch up now" escape hatch for a self-hoster whose cron is not wired up; needs `STATIC_CRON_TOKEN`, not the API key |
| Weekend handling | `weekend` 1–4 | one picker, large payoff on bills |
| `ndom` | `type: ndom`, `moment: "nth,weekday"` (`"2,1"` = 2nd Monday) | "second Tuesday of the month" |

What base Firefly III does **not** have, and will not: a per-occurrence skip, a reminder, a time
of day on a recurrence, or more than five lookahead dates.

---

## 3. The four asks

### 3.1 Fine-tune the repeat

Almost entirely a client-side job — the expressiveness is already in the API.

- Expose `type` fully, including `daily` and `ndom`. `ndom` is the one that unlocks what the
  current model cannot say at all.
- Expose `weekend` as a four-way picker. Bills land on weekends constantly; this is the cheapest
  real win in the whole document.
- Expose `moment` as a consequence of the type, not of the date: day-of-month for `monthly`,
  weekday for `weekly`, nth+weekday for `ndom`, date for `yearly`.
- **Make the editor a list of repetitions** with add/remove. This both fixes §1.2's data loss
  and gives "the 1st and the 15th" for free.
- Drop the quarterly / half-year presets. They are `monthly` + `skip` underneath, they do not
  round-trip, and "every 3 months" is both true and what Firefly III will show. Fewer concepts,
  no lossy mapping, nothing to store on the side.
- End condition: Firefly III takes exactly one of `repeat_until` or `nr_of_repetitions` ("Require
  either a number of repetitions, or an end date. Not both."). Expose all three states — until a
  date / N times / forever — instead of only the one-off-vs-forever checkbox.

The `2099-12-31` sentinel for "forever" can stay for recurrences, but note that Firefly III
applies `before:2038-01-17` to several *other* date fields, including a bill's `end_date` and a
piggy bank's `start_date` — see §5.

### 3.2 See the list of repeated transactions

Per planned transaction, one screen, two halves:

- **Behind:** `GET /v1/recurrences/{id}/transactions`, paginated through `fetchAllPages`. Each
  one links to the existing transaction detail screen.
- **Ahead:** `repetitions[].occurrences` for the next five, merged across repetitions and
  sorted. For a bill, `pay_dates` gives the same thing from the other primitive.

Five is enough for a card. For a real agenda — "what is coming in November" across every planned
transaction — the app expands the rules itself: a pure function in `src/planned/`, which is
where `repetitionFor()` already does the inverse mapping. Lazy and correct: **cross-check the
expander against Firefly III's own `occurrences` in a test**, so the two can never drift. That
is the one runnable check this feature needs.

### 3.3 Cancel one occurrence without cancelling the pattern

Base Firefly III has no per-occurrence skip, and `active: false` is not it — the job filters on
`active` for the whole recurrence (`app/Jobs/CreateRecurringTransactions.php` L185–187), so that
pauses everything.

But Firefly III does keep a per-occurrence record of what it has already handled
(`createdPreviously()`, §2), which means **a date that has been booked is never booked again**,
by cron or by trigger. That makes a cheap design possible:

> A skipped occurrence is one that gets booked and immediately deleted.

- Record skipped dates as a marker in the recurrence's notes —
  `mmyway-skip: 2026-11-01,2026-12-01` — alongside the `mmyway-time:` marker that
  `src/planned/plannedTime.ts` already keeps there. Server-side, so it survives a reinstall and
  a recurrence id change, and it is readable in FF3's web UI.
- In `pullUnreviewedRecurring()`, a review card whose date is in the skip list is not shown —
  it goes straight down the existing `deleteRecurringReview()` path.

No new table, no new endpoint, no backend. One marker and one branch, reusing the delete that is
already written.

Two things to confirm on the test instance before committing to it, both in §7.

If the app owns the schedule instead (§4), this gets cleaner still: a skipped occurrence is one
the app simply never triggers, and nothing is ever written to the ledger.

### 3.4 Remind me at a time I choose

Purely client-side. Firefly III has nothing here and never will.

- `expo-notifications`, `scheduleNotificationAsync` with a date trigger, one per upcoming
  occurrence, re-scheduled on each sync from the occurrence list in §3.2. A new dependency, but
  there is no native or already-installed path to a scheduled local notification in this app.
- Reuse `fields.time` — it is already stored, already in the recurrence's notes, already
  editable in the detail screen. Add a lead time: "2 days before, at 09:00".
- Android 13+ needs `POST_NOTIFICATIONS`. Exact alarms need `SCHEDULE_EXACT_ALARM`; **do not ask
  for it** — a bill reminder tolerates a few minutes of drift, and the permission is a Play
  Store review liability for no user-visible gain.
- Schedule only the next ~30 days' worth. Android throttles large numbers of pending alarms, and
  the list is rebuilt on every sync anyway.

This is the ask with the best ratio in the document: no FF3 constraints, no sync semantics, no
migration.

---

## 4. Who owns the schedule

Two coherent designs. They differ in where "confirm" sits.

**A — Firefly III's cron books; the app reviews.** What is built today. The cron writes the
transaction, the app pulls it as a review card, the user approves or corrects or deletes.
Reliable, already working, and the reason §1.3 and §3.3 are awkward.

**B — The app is the scheduler.** The recurrence stays in Firefly III as the *definition* (so FF3's
web UI still shows it), the app computes occurrences, reminds at the chosen time, and calls
`POST /v1/recurrences/{id}/trigger?date=…` when the user confirms. Confirm becomes real:
nothing is in the ledger until the user says so. A skipped occurrence is one never triggered.

B is what Wallet felt like, and it honours `AGENTS.md`'s confirm rule properly rather than
retroactively. But it has a hole that cannot be closed from the client: **if Firefly III's cron
is running, it books on the day regardless, and the app cannot turn it off.** B only holds on an
instance whose recurring cron is off, which is not a thing to ask a user to arrange.

**Recommendation: stay on A, and build §3.1–§3.4 on top of it.** The four asks do not need the
inversion:

- fine-tuning is a client-side editor over fields FF3 already has;
- the occurrence list is two reads;
- the skip is a notes marker plus the delete that already exists;
- the reminder is local notifications.

Which means the "meh" is fixable in four contained changes with the current control flow intact.
Keep B on the shelf for the case where cron turns out to be the thing self-hosters cannot get
working — and note that the `GET /api/v1/cron/{cliToken}` escape hatch in §2 addresses that case
much more cheaply than inverting the design.

Do not add a setting for which mode is active. If it ever becomes necessary, derive it: review
cards arriving for dates the app did not trigger mean the cron is on.

---

## 5. Base-Firefly-III compatibility ledger

What "no patches" costs, and what it does not.

**Raise the floor to 6.7.0.** `src/api/ff3/auth.ts` has `MIN_API_VERSION = [6, 3, 2]`. The
recurrence `moment` validation, tag by tag:

| | `repetitions.*.moment` on **update** |
| :--- | :--- |
| v6.0.0, v6.1.0 | `'between:0,10'` |
| v6.1.25 → v6.6.0 | `'min:0\|max:10\|numeric'` ← the bug |
| **v6.7.0** → `main` | `['nullable', 'string', 'min:0', 'max:10']` ← fixed |

That `numeric` is what `replay.ts` works around, and the workaround is expensive:

> So a schedule change replaces the recurring transaction instead of updating it: the old one is
> deleted first (never two booking at once), then a new one is created with the whole schedule.

On 6.7.0+ a schedule change is a plain `PUT`. That removes the delete-and-recreate dance, its
`replacedRecurrenceIds` bookkeeping, and the retry states that come with it — and it keeps the
recurrence **id stable**, which matters directly for §3.3, since a notes marker on a recurrence
that gets recreated has to be carried across by hand. Cost: users on 6.3.2–6.6.x, against a
release line that ships roughly monthly.

**The bill-notes patch has to go, and one thing gets worse.** `ynab-bucket-budgeting.md` §7.8
has the detail: `['nullable', ...]` is merged to `main`, absent from v6.7.7, and the `" "`
trick does not work because Laravel's `TrimStrings` is in FF3's global middleware. So on base
Firefly III today, **a planned transaction's note can be set and changed but not cleared.**
Options, in order of laziness:

1. Leave the note alone when it is emptied, and say so in the UI ("clearing a note needs
   Firefly III ≥ the release after 6.7.7"). Smallest diff, honest, self-healing on upgrade.
2. Write a placeholder (`"—"`) the app reads back as empty. Works everywhere, visible in FF3's
   web UI forever.
3. Keep the patch. Off the table — it is the thing being removed.

**Take (1).** It is the only one that gets *better* with no further work.

**The one-off → repeating end date is fixable on base FF3.** `billBody()` says an end date left
over from a one-off "stays on the bill until FF3 can be sent a null". It does not need a null: a
bill's `end_date` is validated `['date', 'after:date', 'after:1970-01-02', 'before:2038-01-17']`
(`Bill/UpdateRequest.php` L87). So send **`end_date: '2038-01-16'`** when switching a one-off to
repeating — the far-future sentinel the recurrence side already uses, just inside FF3's bound.
No patch. (Note `2099-12-31` would be rejected here; the recurrence's `repeat_until` is bounded
differently.)

---

## 6. Build order

Smallest-first, each one shippable alone.

1. **Reminders** (§3.4). No FF3 surface, no sync semantics, nothing to migrate. Highest ratio
   in the document.
2. **The `end_date: '2038-01-16'` fix** (§5). One line, removes a known-wrong behaviour.
3. **The occurrence list** (§3.2), reads only — `occurrences` merged with
   `GET /v1/recurrences/{id}/transactions`. Makes the schedule legible, which is half of what
   "fine-tuned" means; also the data source §3.4 reminds from.
4. **Widen the repetition editor** (§3.1) — `daily`, `ndom`, `weekend`, real `moment`, the end
   condition, and the repetitions *array*. Fixes both §1.2 bugs. Needs the 6.7.0 floor first, or
   it inherits the delete-and-recreate dance for every edit.
5. **Per-occurrence skip** (§3.3), once §7's two questions are answered.
6. **Drop the bill-notes patch** (§5) when the `nullable` release lands; until then, option (1).

Issues to file now, per `AGENTS.md` (`mkloouo/mmyway`): the multi-repetition data loss and the
`daily`/`ndom` misread from §1.2. Both are silent corruption of data made in FF3's web UI, and
both are independent of everything else here.

---

## 7. To settle on the test instance

`npm run ff3:test -- fresh`, then `npm run ff3:test -- cron --date …`. Both questions gate §3.3.

1. **Does deleting a booked occurrence let it come back?** `createdPreviously()` queries
   `journal_meta` for `recurrence_id` + `recurrence_date` and does **not** filter on the
   journal's `deleted_at` (L74–91), and Firefly III soft-deletes journals — so the marker should
   survive the delete and the date should not re-fire. `recurrences.latest_date` only moving
   forward points the same way. Both are inferences from reading, not observations. Check:
   trigger a date, delete the transaction, run cron for that date again, see whether a second
   one appears. If it does, the skip in §3.3 is self-correcting but noisy, and that changes
   whether it is worth shipping.
2. **Does a recurrence's `notes` survive a `PUT` that does not send them?**
   `plannedTime.ts`'s header says FF3's recurrence update strips newlines from notes — hence the
   bill/recurrence split for the user's note. Before adding a second marker to the same field,
   confirm the exact behaviour: whether an omitted `notes` key preserves the stored value, and
   whether two comma-separated markers survive a round trip intact.
