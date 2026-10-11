# Planned Transactions — Development Plan

Companion to `planned-transactions.md` (the feasibility research) and to
`ynab-bucket-budgeting-plan.md`. That document asks *what base Firefly III allows*; this one says
*what to build, in what order, and what each step touches*.

**Target: Firefly III 6.7.7, stock image, no patches.** Every rule below was re-read in the
`firefly-iii/firefly-iii` v6.7.7 source on 2026-10-11 (file + line given). Nothing is from memory or
from the research doc's summary.

---

## 0. What the second pass changed

The research doc's §4 recommendation (**stay on design A** — FF3's cron books, the app reviews) and
its four asks all hold. Six specifics do not.

### 0.1 Reminders (§3.4) are already shipped

`planned-transactions.md` §1.4 says *"No reminders. `expo-notifications` is not a dependency"*, and
§6 puts reminders first in the build order. Both are stale as of commit `532701a`
*feat(planned): add local notification reminders 2 days before and on the day*:

- `expo-notifications` is `~57.0.22` in `package.json`, with the config plugin in `app.config.js`
  and `POST_NOTIFICATIONS` + `RECEIVE_BOOT_COMPLETED` in the Android permission list.
- `src/planned/notifications.ts` schedules one `SchedulableTriggerInputTypes.DATE` notification per
  upcoming planned transaction on its own Android channel, cancels and rebuilds the whole set on
  every change, reuses `fields.time` (falling back to 09:00) and is serialised against itself.
- There is a Settings toggle (`app/(tabs)/settings.tsx` L322–324,
  `getPlannedNotificationsEnabled`).
- `SCHEDULE_EXACT_ALARM` was correctly not requested.

What is actually left of §3.4 is the **lead time** — "2 days before" is hardcoded — and that is a
small phase at the end, not the first one.

### 0.2 The two blockers in §5 are both fixed in 6.7.7

| | v6.7.7 |
| :--- | :--- |
| `repetitions.*.moment` on **update** | `['nullable', 'string', 'min:0', 'max:10']` — the `numeric` bug is gone (`Recurrence/UpdateRequest.php` L100) |
| `notes` on a **bill** update | `['nullable', 'min:1', 'max:32768']` — the fix shipped; `main`-only in the research doc's table, which is wrong (`Bill/UpdateRequest.php` L92) |

So the bill-notes patch is removable now, not "when the next release lands", and the whole
`TrimStrings` / `"—"` placeholder discussion in §5 is moot. The patch has been removed from
`tools/ff3-test/` in this pass; the production server's mount has to go with it.

`moment`'s 10-character budget fits every type exactly: `''` for daily, `1`–`7` weekly, `1`–`31`
monthly, `n,d` for ndom, `Y-m-d` (10 chars) yearly — per-type rules in
`app/Validation/RecurrenceValidation.php` L219–384, where `validateDaily` requires the moment to be
**empty** and `validateYearly` parses it with `Carbon::createFromFormat('Y-m-d', …)`.

### 0.3 §7 question 1, answered from the source: the inference was wrong, the conclusion holds

*Does deleting a booked occurrence let it come back?* The research doc guessed the `journal_meta`
marker survives a delete because `createdPreviously()` does not filter `deleted_at`. It does not
survive:

- `app/Handlers/Observer/DeletedTransactionJournalObserver.php` L73 calls
  `$transactionJournal->transactionJournalMeta()->delete()`, and `TransactionJournalMeta` uses
  `SoftDeletes` (L41), so `createdPreviously()`'s `TransactionJournalMeta::query()` no longer sees
  the rows.
- `getJournalCount()` explicitly filters `whereNull('transaction_journals.deleted_at')`
  (`RecurringRepository.php` L218), so the earlier guard misses it too.

Two *other* guards are what actually make it safe:

- `handleOccurrence()` returns immediately unless the occurrence date **equals the cron's run date**
  (`CreateRecurringTransactions.php` L271–274). A past date is never revisited.
- `validRecurrence()` skips any recurrence whose `latest_date` is the run date — `hasFiredToday()`,
  L464. Once today's occurrence is booked, a second run today does nothing.

**Consequences for §3.3.** Deleting *today's* booked occurrence today is safe. But the research doc's
design — *"a skipped occurrence is one that gets booked and immediately deleted"* — **does not work
for a future date**: pre-trigger it, delete it, and when the day arrives the meta is gone and the
cron books it again. Worse, `POST /v1/recurrences/{id}/trigger?date=…` calls `markGroupsAsNow()`
(`TriggerController` L81, `RecurringRepository` L450–461), which **dates the created journal
*today*, not the occurrence date**, and then restores `latest_date`. So pre-booking cannot even
claim the right date.

The skip therefore becomes *suppress on arrival*, which is simpler than what was proposed: record
the skipped date in the recurrence's notes, and when the review card for that date shows up, send it
straight down the existing delete path. Nothing is pre-triggered.

(That `markGroupsAsNow` behaviour also makes the comment in `src/sync/recurringReview.ts` L30–32 —
*"triggering a recurrence early books it on its future date"* — wrong. The lookahead window it
justifies is harmless, but the comment should say what actually happens: the Planned tab's **"book
now" dates the transaction today**, whatever occurrence it fired.)

### 0.4 §7 question 2, answered from the source

*Does a recurrence's `notes` survive a `PUT` that does not send them?* **Yes.**
`RecurrenceUpdateService::update()` L91 only touches notes when
`array_key_exists('notes', $info)`; an omitted key leaves the stored note alone, and `''` deletes it
(`setNoteText` L148–162, which otherwise only `trim()`s).

*Are newlines stripped?* **Yes, at the request layer, not the service.** The recurrence update maps
`'notes' => ['notes', 'convertString']` (`Recurrence/UpdateRequest.php` L69) and `convertString` →
`clearString` does `str_replace(["\r","\n","\t","\036","\025"], '', …)`
(`app/Support/Request/ConvertsDataTypes.php` L133). A **bill** update maps notes through
`stringWithNewlines` instead (`Bill/UpdateRequest.php` L64), which is exactly why this app keeps the
user's note on the bill and the machine marker on the recurrence. That split is correct and stays.

So: **several markers can share a recurrence's notes as long as they stay on one line.** That is the
foundation of §3.3's skip list, and `src/planned/plannedTime.ts` already works that way — its regex
finds the marker anywhere in the text precisely because of this.

### 0.5 Both §1.2 bugs confirmed — and a third

`updateRepetitions()` (`RecurrenceUpdateService.php` L269–301) deletes all repetitions and recreates
them whenever the submitted count differs from the stored one. `recurrenceBody()` always sends
`repetitions: [one]`. So a "1st and the 15th" recurrence built in FF3's web UI loses the 15th on any
schedule edit. Confirmed. `frequencyFromRepetition()` returning `monthly` for `daily` and `ndom`
is confirmed by reading `src/planned/model.ts` L89–97.

**The third one is new, and it shapes Phase 2.** When the submitted count *equals* the stored count
and the stored count is **greater than one**, `updateRepetitions` goes down the match path, and
`matchRepetition()` (L126–146) builds a query `WHERE` every submitted field — including the changed
`type`, `moment`, `skip` and `weekend`. Changed values match nothing, and `updateRepetitions` then
**throws `FireflyException('Cannot match recurring repetition to existing repetition.')`**. With
`$originalCount === 1` it returns the first repetition unconditionally and is safe.

In other words: *editing a multi-repetition recurrence in place is impossible at 6.7.7 unless the
new values already equal the stored ones.* The way through is to make the counts differ, so the
delete-and-recreate path runs instead — see §2.3.

### 0.6 The one-off end-date fix is confirmed

A bill's `end_date` is `['date', 'after:date', 'after:1970-01-02', 'before:2038-01-17']` with no
`nullable` (`Bill/UpdateRequest.php` L87), so `null` still fails and the research doc's
**`end_date: '2038-01-16'`** sentinel is right. (`2099-12-31`, which the recurrence side uses for
`repeat_until`, would be rejected here — `repeat_until` is only `['nullable','date']`, L96.)

---

## 1. The schedule model, rewritten

`src/planned/model.ts`'s five presets plus "every N" are replaced by what Firefly III actually holds.
This is the centre of the work; everything else is a screen over it.

```ts
export type RepetitionType = 'daily' | 'weekly' | 'ndom' | 'monthly' | 'yearly';

/** One FF3 recurrence repetition. `moment`'s shape is decided by `type` — see RecurrenceValidation. */
export interface Repetition {
  /** FF3's id when it has one; absent on a repetition added here. */
  id?: string;
  type: RepetitionType;
  /** '' daily · '1'–'7' weekly (ISO) · '1'–'31' monthly · 'n,d' ndom (n 1–5, d 1–7) · 'Y-m-d' yearly */
  moment: string;
  /** Every how many periods minus one: FF3's own `skip`, sent as it is. */
  skip: number;
  /** 1 do nothing · 2 skip · 3 move to Friday · 4 move to Monday */
  weekend: 1 | 2 | 3 | 4;
}

/** FF3 takes exactly one of `repeat_until` and `nr_of_repetitions` — "Not both." */
export type EndCondition =
  | { kind: 'forever' }
  | { kind: 'until'; date: string }
  | { kind: 'times'; count: number };
```

In `PlannedFields`, `frequency: Frequency` and `every: number` go; `repetitions: Repetition[]` and
`end: EndCondition` arrive. `repeats: boolean` and `date: string` stay — `repeats: false` is still
"once", which FF3 expresses as `nr_of_repetitions: 1`, i.e. `end: { kind: 'times', count: 1 }`.
`FREQUENCIES`, `Frequency`, `frequencyFromBill`, `frequencyFromRepetition` and `repetitionFor` all
go. `frequencyName`/`scheduleLabel` in `labels.ts` are rewritten against the new type.

### 1.1 The schedule has one source of truth, and it is the recurrence

Today `fieldsOf()` prefers the **bill's** `repeat_freq` when the planned transaction repeats
(`model.ts` L110–115) and the recurrence's repetition otherwise. That is the actual root of the
quarterly / half-year round-trip loss the research doc describes as a symptom: two objects hold the
schedule, they disagree, and whichever is read last wins.

**Fix the cause.** The recurrence's `repetitions[]` is the schedule. The bill's `repeat_freq`/`skip`
is **derived** from it on write and never read back as a schedule — because a bill cannot express
what a recurrence can (`'repeat_freq' => 'in:weekly,monthly,quarterly,half-year,yearly'`,
`Bill/UpdateRequest.php` L89: no daily, no ndom, no multiple repetitions). The bill exists for
`link_to_bill` matching and for `paid_dates`/`pay_dates`, and an approximation is good enough for
both — as long as it is one explicit, tested function:

```ts
/** The closest `repeat_freq` + `skip` a bill can hold for these repetitions. Lossy on purpose. */
export function billSchedule(reps: readonly Repetition[]): { repeat_freq: string; skip: number }
```

with `daily → weekly, skip 0`, `ndom → monthly`, multiple repetitions → the most frequent one, and
`monthly` + `skip` kept as `monthly` + `skip` rather than being re-labelled `quarterly`.

Dropping the quarterly/half-year presets is the other half: they were `monthly` + `skip: 3n−1`,
they never round-tripped, and "every 3 months" is both true and what Firefly III displays.

### 1.2 `scheduleChanged` and the queued-payload shape

`scheduleChanged()` compares `repetitions` (deep, order-insensitive) and `end` instead of
`frequency`/`every`. `withScheduleOf()` loses its purpose once Phase 1 removes the
delete-and-recreate dance; let `knip` confirm it is dead and delete it.

**A queued `save_planned` written by an older build must still replay after the update.**
`payload_json` is versioned but `readPayload` throws on a shape mismatch, which would fail the op
with an unhelpful message. Cheapest correct handling: in `src/sync/payloadJson.ts`, make
`fields.frequency`/`fields.every` **optional** alongside an optional `fields.repetitions`, and add
one pure `normalizeFields()` in `model.ts` that turns a legacy `(frequency, every)` pair into a
`repetitions` array on read. One function, one test, no version-translation layer. A
`PAYLOAD_VERSION` bump with a v1→v2 converter is the alternative and is strictly more code for the
same result.

---

## 2. Endpoint contract

| Call | Why | Notes |
| :--- | :--- | :--- |
| `GET /v1/recurrences` | already pulled into `planned_objects` | `repetitions[].occurrences` (5 dates, 9 for daily) and `repetitions[].description` (localised) **are already in the cache and unread** — `RecurringEnrichment.php` L364–382 |
| `GET /v1/recurrences/{id}/transactions` | past occurrences | `routes/api.php` L532; paginate with `fetchAllPages` |
| `POST /v1/recurrences/{id}/trigger?date=…` | "book now" | already used. `setForce(false)`, then `markGroupsAsNow()` → **the journal is dated today**, and `latest_date` is restored (§0.3) |
| `PUT /v1/recurrences/{id}` | schedule, markers | omit `notes` to preserve it; `''` clears it; newlines are stripped |
| `GET /v1/bills` | `paid_dates`, `pay_dates`, `next_expected_match` | `BillTransformer.php` L95–98. The app reads only `next_expected_match` |
| `GET /api/v1/cron/{cliToken}` | "catch up now" escape hatch | `routes/api.php` L51, `withoutMiddleware(['api'])`. Needs `STATIC_CRON_TOKEN`, not the API key |

### 2.1 Occurrences are future-only

`RecurringEnrichment` calls `getXOccurrencesSince($repetition, $recurrence->latest_date ?? first_date, now(), $amount)`.
Dates before now are filtered out. So the "ahead" half of §3.2 is free from the cache and the
"behind" half needs `/transactions`; there is no way to get past occurrences out of `occurrences`.

### 2.2 Five is the ceiling

Five future dates per repetition (nine for daily), and no parameter raises it. A per-planned-transaction
card is fine. A cross-planned-transaction agenda ("what is coming in November") needs the app to
expand the rules itself — a pure function in `src/planned/`, **cross-checked against FF3's own
`occurrences` in a test** so the two cannot drift. That is Phase 3's one runnable check and the
reason the expander is worth having at all.

### 2.3 The multi-repetition write rule

From §0.5, the only reliable way to change a recurrence's repetition set:

> If the recurrence currently holds **more than one** repetition and the new set has the **same
> count**, send an intermediate `PUT` carrying exactly **one** repetition first, then the real body.

Both PUTs then have a count mismatch, so `updateRepetitions` takes the delete-all-recreate branch
and never attempts a match. Repetition ids change; nothing references them across requests (the app
re-reads the recurrence anyway), so that is free. A failure between the two leaves a valid
single-repetition recurrence rather than a broken one, and the replay — which is idempotent on the
final body — converges on the next attempt.

Count 1 → anything, and count N → different N, are single PUTs.

This replaces today's workaround, which deletes and recreates the **whole recurring transaction** on
every schedule change (`src/planned/replay.ts` L150–170) — a far bigger hammer, carrying
`recurrenceReplaced` and `replacedRecurrenceIds` through the payload, and losing the recurrence id
(and with it any notes marker) each time.

---

## 3. Phases

Each is shippable alone, with its `CHANGELOG.md` line under `[Unreleased]` in the same commit
(`AGENTS.md`), written for the person installing the app.

### Phase 1 — Raise the floor to 6.7.0 and delete the workarounds

The unlock. Pure subtraction: no new screen, no new field, a meaningfully smaller `replay.ts`.

1. `src/api/ff3/auth.ts`: `MIN_API_VERSION = [6, 7, 0]`. The `api_version_too_low` copy names 6.7.0.
2. `src/planned/replay.ts`: delete the comment block at L150–156 and the three blocks it guards —
   the `recurrenceReplaced` flag, the `replacedRecurrenceIds` loop, and the `recurrenceReplaced ||
   adoptedRecurrence` branch of `recurrenceBefore` (keep `adoptedRecurrence`: a recurrence found by
   title really does already carry the queued schedule). A schedule change becomes a plain `PUT`.
3. `src/planned/actions.ts`: drop the `payload.recurrenceReplaced && payload.before` merge branch in
   `savePlanned`.
4. `src/sync/payloadJson.ts`: leave `recurrenceReplaced` and `replacedRecurrenceIds` in the schema
   as optional so an op queued by the previous build still parses and replays. Remove them a release
   later.
5. `src/planned/model.ts` `billBody()`: send **`end_date: '2038-01-16'`** when a repeating planned
   transaction is saved, instead of omitting the key — that is the §0.6 fix, and it clears an end
   date left behind by a one-off. Correct the two comments that describe stock FF3 refusing `null`
   notes and refusing a date `moment` on update; both are false at 6.7.0+.
6. Operations, outside the repo: unmount the patched
   `app/Api/V1/Requests/Models/Bill/UpdateRequest.php` from the production server. `tools/ff3-test/`
   is already stock (`patches.json` → `basedOn: "6.7.7"`, empty list).

**Tests:** `src/planned/replay.test.ts` loses the replacement cases and gains "a schedule change is
one PUT and keeps the recurrence id"; `model.test.ts` gains the `end_date` sentinel; an
`auth.test.ts` case for a 6.6.x server being refused. `.maestro/flows/planned/P1-create-reschedule-delete.yaml`
should pass unchanged — if it does not, the schedule path is not equivalent.

**Cost:** users on 6.3.2–6.6.x are locked out until they upgrade, against a release line that ships
roughly monthly. Say it in the CHANGELOG and in the sign-in error, not in a release note nobody reads.

**Risk:** this is the phase that touches money-moving code paths. The `.maestro` planned flows plus
`npm run ff3:test -- fresh` + `cron --date …` are the gate.

### Phase 2 — The repetition editor

The §1 model rewrite, both §0.5 data-loss bugs fixed, and the four affordances the Wallet
comparison is really about.

1. `model.ts`: the new types, `repetitionsFor`/`billSchedule`, `normalizeFields`, `scheduleChanged`,
   the `recurrenceBody` repetition array with ids preserved, and the end condition
   (`repeat_until` for `until` / `forever`, `nr_of_repetitions` for `times`, exactly one of them).
2. `replay.ts`: the §2.3 two-step rule for a same-count multi-repetition change. One branch, one test.
3. `labels.ts`: `scheduleLabel` over `Repetition[]`. Prefer FF3's own
   `repetitions[].description` when the cache has it — it is already localised and already there,
   and composing a second description is work with a drift risk.
4. `app/planned/[key].tsx`: the frequency `PickerSheet` becomes a **list of repetitions** with
   add/remove, each row being type + moment + "every N" + weekend. `moment` is a consequence of the
   type (day-of-month picker for monthly, weekday for weekly, nth + weekday for ndom, date for
   yearly, nothing for daily), not of `fields.date`. One more row for the end condition, three-way.
5. i18n: new keys in `src/i18n/locales/en.json` and the same keys, empty, in `uk-UA.json`. Grep
   `.maestro/` for every schedule label that changes — the flows tap by text.

**Tests:** `model.test.ts` round-trips every type through `repetitionsFor` → FF3's validation rules
→ back (a daily moment is `''`, an ndom moment is `n,d` with n 1–5 and d 1–7, a yearly moment is
`Y-m-d`); a two-repetition recurrence survives a non-schedule edit and a schedule edit; the legacy
`(frequency, every)` payload normalises. `replay.test.ts` asserts the intermediate single-repetition
PUT fires exactly when §2.3 says and not otherwise.

**Issues to file first** (`AGENTS.md`: open bugs are GitHub Issues in `mkloouo/mmyway`): the
multi-repetition data loss and the `daily`/`ndom` misread. Both are silent corruption of data made
in Firefly III's web UI, both are independent of everything else here, and the Phase 2 PR says
`Fixes #N` for both.

### Phase 3 — The occurrence list

Reads only. Makes the schedule legible, which is half of what "fine-tuned" means, and it is the data
source the skip and the reminders both want.

- **Ahead:** `repetitions[].occurrences` merged across repetitions and sorted. Already cached.
- **Behind:** `GET /v1/recurrences/{id}/transactions` through `fetchAllPages`, each row linking to
  the existing transaction detail screen.
- **The expander** (`src/planned/occurrences.ts`): a pure function from `Repetition[]` + a window to
  dates, honouring `skip` and `weekend`, with a test that cross-checks it against the `occurrences`
  Firefly III sent for the same repetition. That test is the whole point: it is what stops the two
  from drifting as `weekend` and `ndom` get exercised.
- Screen: a section on `app/planned/[key].tsx`, not a new route, until there is a reason for one.

### Phase 4 — Per-occurrence skip

1. Generalise `src/planned/plannedTime.ts` into `src/planned/notes.ts`: `readMarkers(notes)` /
   `writeMarkers(markers)` / `stripMarkers(notes)` over a one-line marker set, with `mmyway-time`
   and `mmyway-skip` as its two keys. Recurrence notes are newline-stripped (§0.4), so everything
   stays on one line — which is already why `plannedTime`'s regex searches anywhere in the text.
   `fieldsOf`'s `stripPlannedTime(rec?.notes)` becomes `stripMarkers`, or a recurrence without a
   bill would show `mmyway-skip: …` as the user's note.
2. Skipping an occurrence adds its date to `mmyway-skip` and queues an ordinary `save_planned`.
   Server-side, so it survives a reinstall, and visible in FF3's web UI.
3. `src/sync/recurringReview.ts` `pullUnreviewedRecurring()`: a journal whose `recurrence_date`
   (or, failing that, its date) is in the owning recurrence's skip list is **not** turned into a
   review card — it goes straight down the existing `deleteRecurringReview()` path. One branch,
   reusing the delete that is already written.
4. The UI is one row per upcoming occurrence in Phase 3's list, with a "skip this one" action.

**Why not pre-book and delete:** §0.3. The meta is soft-deleted with the journal, so a future date
pre-triggered and deleted is simply booked again on the day — and `markGroupsAsNow` would have dated
it today anyway. Suppress-on-arrival is both correct and smaller.

**Honest limit to state in the UI:** Firefly III still books the transaction on the day; the app
deletes it on the next sync. The user never sees it, but a soft-deleted journal exists and
`latest_date` moved. That is the price of base Firefly III having no per-occurrence skip, and
`active: false` is not an alternative — the job filters on `active` for the whole recurrence
(`CreateRecurringTransactions.php` L424–428).

**Tests:** `notes.test.ts` (both markers on one line, round-trip, a user's note preserved, an
unknown marker left alone); a `recurringReview.test.ts` case where a skipped date produces a
`delete_transaction` op and no inbox item.

### Phase 5 — Reminder lead time

Small, on top of what already ships. `computePlannedNotificationTargets` takes the lead times from a
setting instead of the hardcoded `twoDaysBefore`/`dayOf` pair; a row on the planned detail screen or
in Settings chooses it. Keep the ~30-day scheduling horizon and the rebuild-on-every-sync behaviour
exactly as they are — Android throttles large numbers of pending alarms, and the current design is
right.

---

## 4. Not doing

| Not doing | Why |
| :--- | :--- |
| Design B (the app is the scheduler) | §4 of the research doc: it only holds on an instance whose recurring cron is off, and the app cannot turn it off. Keep it on the shelf; the `GET /api/v1/cron/{cliToken}` escape hatch addresses the case it was meant for far more cheaply |
| A setting for which mode is active | derive it if it is ever needed: review cards arriving for dates the app did not trigger mean the cron is on |
| More than five lookahead dates from FF3 | no parameter for it. Phase 3's expander covers the agenda case |
| A time of day on the recurrence itself | FF3 has no field. The `mmyway-time` marker already covers it |
| `SCHEDULE_EXACT_ALARM` | a bill reminder tolerates minutes of drift, and the permission is a Play Store review liability for no visible gain |
| Non-monthly bill approximation beyond §1.1 | the bill is for matching and paid state, not for booking |

---

## 5. Settle on the test instance before Phase 2

`npm run ff3:test -- fresh` (now stock 6.7.7), then `npm run ff3:test -- cron --date …`. §0.3 and
§0.4 answered the research doc's two questions from the source; these are the new ones, and §0.5 is
the one that would cost the most to get wrong.

1. **Does a same-count multi-repetition `PUT` really 500?** Create a two-repetition recurrence in
   FF3's web UI, `PUT` two changed repetitions, and read the status and body. If it is a clean 422
   rather than a `FireflyException`, §2.3's intermediate PUT can be replaced by a retry — simpler
   still.
2. **Does the intermediate single-repetition `PUT` lose anything else?** `updateRepetitions`'
   delete-and-recreate only touches repetitions, but confirm the transactions, the bill link and the
   notes come through both PUTs intact.
3. **Does `trigger?date=…` really date the journal today?** §0.3 says `markGroupsAsNow` does. Verify,
   because the Planned tab's "book now" and the Inbox's `plannedDateFor` both depend on which date
   the review card arrives with.
4. **Is `recurrence_date` meta written with the occurrence date or the run date?** Phase 4 matches
   skipped dates against it. If it is the run date, match on the journal's date instead.
5. **Does a `weekend: 2` (skip the weekend) occurrence disappear or shift?** It changes what Phase
   3's expander must reproduce, and the cron's `addDays(2)` lookahead
   (`CreateRecurringTransactions.php` L375–377) suggests a shift, not a skip.

Anything found and not fixed becomes a GitHub issue; the PR that closes one says `Fixes #N`.

---

## 6. Order, and why

```
1  floor 6.7.0 + delete the workarounds      pure subtraction, unblocks everything
2  repetition editor                          the actual feature; fixes two silent-corruption bugs
3  occurrence list                             reads only; the data source for 4 and 5
4  per-occurrence skip                         one marker + one branch, on top of 3
5  reminder lead time                          polish on something already shipped
```

Phase 1 before Phase 2 is not a preference: building the repetitions array on top of the
delete-and-recreate dance means every schedule edit still destroys and rebuilds the recurring
transaction, and a `mmyway-skip` marker on a recurrence that gets recreated has to be carried across
by hand — which is Phase 4 inheriting a problem Phase 1 deletes for free.
