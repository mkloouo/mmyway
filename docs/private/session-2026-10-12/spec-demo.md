# Spec — Demo / Sandbox mode (roadmap §2.8)

Goal: a Google Play reviewer (or anyone curious) can use the app with no Firefly III server.

## How the app already behaves signed out

- No sign-in gate: the app opens to its tabs; Settings → Firefly III signs in.
- `runSync` (`src/sync/runSync.ts` ~202) returns `NOT_SIGNED_IN` when there are no stored
  credentials, so **nothing ever reaches the network** while signed out. The demo leans on that:
  demo = signed out + seeded SQLite + a flag. No sync code changes.

## Design

- `app_settings` key `demo` = `'1'` (helpers `getDemoMode`/`setDemoMode` in
  `src/settings/appSettings.ts`, same style as the others; **not** in `INSTANCE_SETTING_KEYS`, it is
  cleared explicitly).
- `src/demo/seed.ts` — `loadDemoData(db, today)`: builds rows from `tools/ff3-test/seed.json`
  (imported as JSON; Metro bundles it) and writes them in one transaction:
  - `reference_currencies` (from `currencies`, first is default), `reference_accounts` (asset +
    expense/revenue; balance = opening balance minus/plus the seeded transactions that touch it),
    `reference_categories`, `reference_budgets` (ids `demo-<n>`).
  - `cached_transactions` from `transactions` expanded like `scripts/ff3-test.mjs` does
    (`eachMonth`, `day`, `{month}` in descriptions, `daysAgo`), ids `demo-<n>`, dates relative to
    `today`.
  - `planned_objects` for `bills` (bill row only).
  - `bucket_objects`: a `budget_limit` for Food this month (e.g. `400.00`) and `budget_spent`
    summed from this month's seeded withdrawals with `budget_name: Food`.
  - Amounts are strings; sums via `src/api/ff3/decimal.ts`, never `number`.
  - The id schemes and row shapes must match what `src/sync/referenceData.ts` and
    `src/sync/bucketData.ts` write — reuse their mappers if exported.
- `startDemo(db)`: refuses if signed in (`readStoredCredentials()`), else
  `clearInstanceData(db)` → `loadDemoData` → `setDemoMode(true)`.
- `leaveDemo(db)`: `clearInstanceData(db)`, delete **all** `outbox_operations` and all
  `inbox_items` (everything was made in the demo), `setDemoMode(false)`.
- **Safety — `connectToInstance` (`src/settings/connectInstance.ts`)**: if demo mode is on, call
  `leaveDemo(db)` before `signIn`, inside `withSyncPaused`. Otherwise demo captures would replay
  into the reviewer's/user's real Firefly III on the first sync. Unit-test this.
- Fix on the way: `clearInstanceData` (`src/sync/instanceData.ts:51`) doesn't clear
  `bucket_objects`, so switching instances kept the old instance's envelope amounts. Add it to the
  table list (and its test).
- `app/e2e-sign-in.tsx` and the `mmyway-dev` scheme are **not touched**.

## UI (`app/(tabs)/settings.tsx`)

- Signed out and not in demo: a row under Firefly III — "Try the demo" → `confirmAction`
  ("Try the demo?", body: "Fills the app with sample accounts and transactions. Nothing is sent
  anywhere. Leave the demo from Settings.") → `startDemo`.
- In demo: Firefly III row value "Demo" ; a "Leave the demo" row → `confirmDestructive`
  ("Leave the demo?", body "Everything you entered in the demo is deleted.") → `leaveDemo`.
- Signing in from the demo keeps working (connect wipes the demo first).
- A small "Demo" chip in the Capture app bar is optional — skip unless trivial.
- i18n: `demo.*` keys in `en.json`, same keys empty in `uk-UA.json`.

## Tests

- `src/demo/seed.test.ts`: row counts per table; dates relative to a fixed `today`; Food spent =
  sum of this month's Food withdrawals; balances.
- `src/demo/demo.test.ts`: start refuses when signed in; start → flag + rows; leave → everything
  gone incl. outbox and inbox; `connectToInstance` while in demo wipes queued ops before signing in
  (mock `signIn`, `expo-secure-store`).
- Screen test for the Settings rows (`src/__screens__/`).

## Maestro

`.maestro/flows/smoke/D1-demo.yaml` (tags `smoke`): runs **without** `ready.yaml` sign-in — fresh
app → Settings → Try the demo → confirm → Budget tab shows "Food" → Activity shows "Biedronka" →
Settings → Leave the demo → confirm → Budget tab empty. No FF3 checks (the point is that nothing
is sent); assert via `expectNoTx` that no demo description reached the test FF3.

## CHANGELOG

Under a `### Settings` (or `### Getting started`) heading: "Try the app without a server. Settings →
Try the demo fills the app with sample accounts, envelopes and transactions; nothing is sent
anywhere, and Leave the demo (or signing in) clears it."
