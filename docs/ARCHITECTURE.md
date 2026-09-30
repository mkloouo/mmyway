# Architecture

mmyway is an offline-first Android client for a self-hosted Firefly III (FF3). Everything the UI shows is read from a local SQLite database; every change the user makes is queued and sent to FF3 by a sync. The app is usable with no network at all, and nothing reaches FF3 without the user confirming it.

Rules that apply everywhere are in `AGENTS.md`; translations are `docs/LOCALIZATION.md`. Open bugs, features and cleanups are tracked in [GitHub Issues](https://github.com/mkloouo/mmyway/issues).

## The pipeline: capture → confirm → sync

```
 capture (manual / receipt / recurring)          sync
        │                                          ▲
        ▼                                          │
  inbox_items ──confirm──► outbox_operations ──replay──► FF3 ──pull──► cached_transactions
  (drafts)                 (queued writes)                             reference_* tables
```

1. **Capture.** An entry becomes an `inbox_items` row holding a draft (`draft_json`):
   - manual: the amount-first Capture screen (`app/capture.tsx`, `src/capture/`), saved by `createManualEntry`;
   - receipt: a photo from the camera, the gallery or another app's share sheet goes through `src/receipt/ingest.ts` (copied out of the cache directory, deduped by hash, downscaled), and a provider chain reads it;
   - recurring review: a sync pulls transactions FF3's recurrences created and lists them for approval.
2. **Parse** (receipts only). `src/receipt/buildChain.ts` builds the chain: the local OpenAI-compatible model first, Gemini as the fallback, each skipped when not configured. `runProviderChain` tries them in order and `toDraft` turns the answer into a draft. Categories and currencies offered to the model come from the synced reference tables.
3. **Inbox.** Drafts wait in the Inbox (`app/(tabs)/index.tsx`, sections from `src/inbox/useInboxSections.ts`) until the user confirms, edits (`app/draft/[id].tsx`) or deletes them.
4. **Confirm.** Mandatory: no code path queues a create, edit or delete without the item passing through `confirmed`. `confirmInboxItem` moves the item and inserts the outbox operation in one step; the Undo snackbar can take it back while the operation is still `pending`.
5. **Sync.** `src/sync/runSync.ts` replays the outbox against FF3 and pulls fresh data back into the cache. A synced item leaves the Inbox and appears in Activity.

### Inbox states

`src/inbox/state.ts` is the whole state machine:

| From                              | Event     | To                                              |
| --------------------------------- | --------- | ----------------------------------------------- |
| `captured`                        | `parsed`  | `parsed`                                        |
| `captured`                        | `confirm` | `confirmed` (manual entries have no parse step) |
| `parsed`                          | `confirm` | `confirmed`                                     |
| `confirmed`                       | `synced`  | `synced`                                        |
| `captured`, `parsed`, `confirmed` | `fail`    | `error`                                         |
| `error`                           | `retry`   | `captured`                                      |

A create the outbox can't send (an account deleted in FF3) hands its item back to `captured`/`parsed` with an `errorMessage`, so the user fixes the draft rather than losing it.

### Edits to transactions already in FF3

Activity (`app/(tabs)/activity.tsx`) and the transaction screen (`app/transactions/[groupId].tsx`) read `cached_transactions`. Saving an edit, a split edit, a delete or a receipt attachment queues an outbox operation directly (the user already confirmed by pressing Save). Until it lands, `src/transactions/pendingEdits.ts` overlays the queued values on the cached row, so Activity shows the edit and marks it queued. A queued delete hides the row at once.

## Data layer

- **SQLite is the source of truth for the UI.** `src/db/schema.ts` defines the tables; `src/db/client.ts` opens them with expo-sqlite and runs migrations; `DbProvider` gates every screen until migrations finish and shows a blocking error (with Share diagnostics) if one fails.
- **Tables.** `reference_accounts`, `reference_categories`, `reference_budgets`, `reference_currencies` (synced from FF3, never hardcoded); `cached_transactions` (Activity, payee history; includes `search_key` for accent- and case-insensitive search); `inbox_items`; `outbox_operations`; `planned_objects` (FF3 bills, rules, recurrences); `app_settings` (key/value preferences); `aliases` (payee text → FF3 payee).
- **Stored JSON is versioned.** `inbox_items.draft_json` and `outbox_operations.payload_json` outlive app versions, so they are written with `v: 1` and validated with zod on read: `src/inbox/draftJson.ts`, `src/sync/payloadJson.ts`. Never `JSON.parse` and cast.
- **Live reads.** Screens read tables through `src/db/useLiveQuery.ts`, a drop-in for drizzle's hook that coalesces change events (at most one re-run per 100 ms, never two in flight). It returns `undefined` until the first read lands, so a screen can tell loading from empty. Pass `deps` when the query depends on a prop.
- **Money is a string.** FF3 amounts stay decimal strings; arithmetic goes through `src/api/ff3/decimal.ts`, and split allocation works in minor units as `BigInt` (`src/splits/allocate.ts`).
- **Secrets** (FF3 token, Gemini key) live in SecureStore (`src/settings/secrets.ts`, `src/api/ff3/auth.ts`), never in SQLite.

## Sync

### When it runs

| Trigger                               | Mode            | Where                                                            |
| ------------------------------------- | --------------- | ---------------------------------------------------------------- |
| App launch, pull-to-refresh, Sync now | full            | `useSync()` (React Query key `['sync']`)                         |
| Resume after 30+ minutes              | full            | `SyncOnResume` in `app/_layout.tsx`                              |
| Any queued write                      | push, debounced | `enqueueOperation` → `requestSync()` (`src/sync/syncTrigger.ts`) |
| Network comes back                    | full            | `SyncOnReconnect` (NetInfo)                                      |
| Background, about every 15 min        | full            | `src/sync/backgroundSync.ts` (WorkManager)                       |

A confirm waits `SYNC_DELAY.afterConfirm` (6 s) so Undo in the 5 s snackbar can still cancel it; other writes wait `afterWrite` (1 s). `runSync` is process-wide single-flight: a call during a sync joins it, except a full sync asked for during a push, which runs next.

### What it does

- **full:** probe every configured FF3 and local-model address and remember the one that answered (`src/sync/reachability.ts`) → pull reference data and prune what FF3 no longer has → replay the outbox → pull unreviewed recurring transactions → retry unparsed receipts → if anything landed, re-read account balances and recent transactions.
- **push:** probe FF3 → replay the outbox → if anything landed, re-read the short catch-up window.

`runSync` never throws; failures come back in its `SyncSummary`, which the status pill and the Sync sheet show.

### Outbox rules

`src/sync/outbox.ts` (read its header comment before changing replay order or retries):

- Operations replay one at a time in `sequence` order. A failure holds back only the later operations that depend on it: those sharing a subject (the same transaction, Inbox entry, account or planned transaction, `src/sync/outboxSubjects.ts`), and in turn whatever depends on those, so a chain of changes keeps its order. Unrelated operations go ahead. When FF3 can't be reached at all (no answer, 5xx, 401/403, 429), or a payload can't be read, the run stops there instead.
- A create carries `internal_reference: mmyway:<clientId>` and `error_if_duplicate_hash`, so a retry after a lost response is recognised as our own duplicate and recorded as success.
- An edit or delete sends `expectedUpdatedAt`; if FF3's copy changed meanwhile, the operation fails as a `conflict` and the transaction screen shows the conflict view (keep mine / use server).
- A failed operation backs off (`next_attempt_at`, 30 s doubling to an hour), and what depends on it waits with it. Retry now in the Inbox skips the wait; Discard removes it (a discarded create returns to the Inbox as a draft).
- `LEDGER_KINDS` are the kinds that change a balance. While any is queued, or balances haven't been re-read since one landed (`balances_stale`), the cash count refuses to book (`src/reconcile/countReadiness.ts`).

### One instance at a time

Queued operations and cached rows carry one FF3 instance's ids. Signing out, or signing in at an address not already stored, is refused while anything is queued and otherwise clears that instance's reference data, cache and reviews (`src/sync/instanceData.ts`). Drafts, aliases and preferences stay.

## Features outside the main pipeline

- **Splits** (`src/splits/`, `src/inbox/draftSplits.ts`, `src/transactions/queueSplitEdit.ts`): a tracked total plus one page per split. When splits and total disagree, split 1 absorbs the difference; if it can't, `AllocationSheet` shows sliders. A split edit sends every split; a removed split is deleted by its journal id.
- **Planned** (`src/planned/`, `app/(tabs)/planned.tsx`): FF3 bills, rules and recurrences cached in `planned_objects`. The simple view edits the name-matched trio as one item and queues `save_planned`/`delete_planned` (`src/planned/replay.ts`); the detailed view is read-only.
- **Cash count** (`app/count.tsx`, `src/reconcile/`): counts every account marked as a cash envelope and books one adjustment per envelope that differs, only when the balances are known to be current.
- **Aliases** (`src/lookup/aliases.ts`): payee text as it arrives (a receipt's printed merchant, a bank's legal name) mapped to the FF3 payee it books to; learned when a draft's payee is corrected.
- **Suggestions** (`src/lookup/merchantLookup.ts`, `src/suggest/rank.ts`): payee history from the cache pre-fills category, account and budget. Pure and offline; warmed at startup so the first Capture opens fast.

## UI layer

- **Routes** live in `app/` (expo-router, typed routes on). Tabs: Inbox, Activity, Planned, Settings. Capture, receipt, draft and count open as modals (`app/_layout.tsx`). `src/providers/`, not `src/app/`, holds the app-level providers (see `AGENTS.md` for why).
- **The kit** is `src/ui/`. `components.tsx` has the primitives (`Screen`, `AppBar`, `BarIconButton`, `Card`, `Row`, `Chip`, `Button`, `Money`, `StatusPill`, `Sheet`, `Toast`, `EmptyState`); around it are `TextField`, `SearchField`, `PickerSheet`, the account/payee/target pickers, `Keypad`, `SplitPager`, `AllocationSheet`, `DetailRows`, `Snackbar`, `SwipeableCard`, `Collapsible` and the Inbox cards.
- **Theme.** Every colour, spacing, radius and type style comes from `useTheme()` (`src/ui/theme.ts`), light and dark. No literal hex in a screen.
- **Feedback.** Every haptic (`src/ui/haptics.ts`) is paired with a visual cue (`src/ui/feedback.ts`: shake, pop, fly-away), so a phone without a vibration motor still shows it.
- **Async handlers** go through `useAction()`, which logs a failure to the Diagnostics log and shows it, instead of an unhandled rejection a release build drops. Destructive prompts use `confirmDestructive()`.
- **Navigation** from a tap uses `navigateOnce()`, which drops a second push inside 800 ms (a double tap used to stack modals).
- **Strings** come from `src/i18n/locales/en.json` through `useTranslation()`; `en` is the source, the rest are pulled from Tolgee.

## Tests

- `npm run check` runs typecheck, lint and Jest; CI runs the same on every push (`.github/workflows/ci.yml`).
- Jest pins `TZ=Europe/Warsaw` (`jest.config.js`) so date tests agree on a laptop and in UTC CI.
- Database tests use `createTestDb()` from `src/db/testDb.ts` (better-sqlite3, in memory). Never import it from anything the app bundles.
- Network is always mocked: no test talks to a real FF3, Gemini or local model.
- Screen and component tests use React Native Testing Library and live in `src/__screens__/`, never under `app/`.
- On a device: `.maestro/` automates the device-run checklist with Maestro, run by `scripts/e2e.mjs` against a throwaway Firefly III from `scripts/ff3-test.mjs` (Docker, SQLite, the production patches, seeded from `tools/ff3-test/seed.json`). Each flow checks its result in Firefly III, not only on screen. See `.maestro/README.md`.

## How to

### Add a screen

1. Create the route file in `app/` (for example `app/things/[id].tsx`) with a default-exported component. Typed routes pick it up after `npm start` regenerates the route types.
2. If it should open as a modal, add a `<Stack.Screen name="things/[id]" options={{ presentation: 'modal' }} />` in `app/_layout.tsx`, and give its `Screen` the `bottom` prop.
3. Build it from the kit: `Screen`, `AppBar` with a close `BarIconButton`, `Card`/`Row`, `Sheet` or `PickerSheet` for choices. Read colours from `useTheme()`.
4. Read data with `useLiveQuery` (pass `deps` for route params); put writes in a function under `src/` and call it through `useAction()`.
5. Open it with `navigateOnce('/things/' + id)`.
6. If the route loads something that may be missing, split it: the route component guards and shows the empty state, and renders an editor component with the loaded value as a non-null prop (`app/planned/[key].tsx` does this).

### Add a user-visible string

Add the key to `src/i18n/locales/en.json`, the same key with an empty value to every other locale file, and read it with `const { t: tr } = useTranslation()` (or `i18n.t` outside React). `src/i18n/locales.test.ts` fails if the files drift. Details in `docs/LOCALIZATION.md`.

### Change the database schema

1. Edit `src/db/schema.ts`.
2. Run `npm run db:generate`. Don't edit the generated SQL.
3. Import the new file in `src/db/migrations.ts` and add it to the `migrations` map under the next `mNNNN` key; `src/db/migrations.upgrade.test.ts` fails until you do.
4. If existing rows need a value, backfill it in code on the next sync rather than in the migration (as `search_key` did).
5. If the table belongs to one FF3 instance, clear it in `clearInstanceData` (`src/sync/instanceData.ts`).

### Add a setting

- A preference: add a key to `KEYS` in `src/settings/appSettings.ts` with a `getX`/`setX` pair, and a `Row` + sheet in `app/(tabs)/settings.tsx`.
- A secret: store it in SecureStore through `src/settings/secrets.ts`, never in `app_settings`.
- Something that belongs to one FF3 instance: make sure `clearInstanceData` removes it.

### Add an outbox operation kind

1. Add the kind to `OutboxKind` in `src/sync/outbox.ts` and define its payload type there.
2. Add its zod schema to `src/sync/payloadJson.ts` (with `v: version`).
3. Handle it in `replayOne` in `src/sync/outbox.ts`. It must be safe to retry after a lost response.
4. If it changes a balance, add it to `LEDGER_KINDS`.
5. Describe it for the Inbox: a case in `describeQueuedChange` (`src/inbox/queuedChanges.ts`) and an `inbox.opKind.<kind>` string (plus `OP_KIND_KEYS` in `src/ui/InboxCards.tsx`).
6. Queue it from a function in `src/` with `enqueueOperation`, which also requests a push sync. If it comes from an Inbox item, it must go through `confirmed` first.
7. Test the replay with a mocked FF3 client, including the retry and conflict paths.

### Add a receipt provider

Implement `ReceiptProvider` (`src/receipt/types.ts`) in `src/receipt/providers/`, add it to the chain in `src/receipt/buildChain.ts` (skipped when not configured), list it in `configuredProviders` in `runSync` so the Sync sheet shows it, and mock `fetch` in its tests.

### Write a screen test

Render the component inside `SafeAreaProvider` with fixed `initialMetrics`, import `../i18n`, and drive it with `fireEvent`/`screen` from `@testing-library/react-native`. `src/__screens__/PickerSheet.test.tsx` is the smallest example. Use `createTestDb()` when the component needs a database.

### Ship a change

1. `npm run check` passes.
2. Anything a user could notice gets a line in `CHANGELOG.md` under `[Unreleased]`, written for the person installing the app.
3. Release with `npm run release -- X.Y.Z`, or from GitHub with the **Release** workflow (mode `release`). See `scripts/release.mjs --help`.

### Release, or build without releasing

`scripts/release.mjs` is one pipeline of named steps. Each step runs on its own with `npm run release -- <step> X.Y.Z`. `npm run release -- X.Y.Z` chains them, skipping any already done, so after a failure you fix the cause and run it again:

| Step             | Does                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `prepare`        | Preflight, type-check, tests, then the version into CHANGELOG, package.json, package-lock.json, app.config.js (uncommitted) |
| `build-android`  | Local EAS production build: split APKs + universal, checked, SHA256SUMS                                                     |
| `commit`         | The `release vX.Y.Z` commit and tag, only once the build has succeeded                                                      |
| `publish-github` | Push main and the tag, then the GitHub release                                                                              |

- **Try before committing.** `--pause` stops after the build. Run the release again to finish it, or `abort X.Y.Z` to drop it.
- **Build without releasing.** `npm run release -- build`, or the workflow's `build` mode, makes the production split APKs of the current commit, with no version change.
- **Who can release.** Only the owner: the workflow checks its actor, the script checks it again, and locally it checks the `gh` login before pushing. The workflow's `EXPO_TOKEN` lives in the `release` environment.
- **Add a step** (a Play Store upload, a local iOS build, a TestFlight upload):
  1. Write a function for it and add it to `STEPS` in `scripts/release.mjs`.
  2. Put it in `RELEASE` where it belongs, or leave it out to run it only on request.
  3. A build step leaves its files in the release folder and rewrites `SHA256SUMS`, and the GitHub release picks them up.

  The header comment of `scripts/release.mjs` has the details.
