# mmyway review: open action items

2026-09-27 · Mykola Odnosumov

This file is the source of truth: tick items off here.

## Status

Both branches are merged and `main` is at `0359c66`. The offline outbox bugs that could lose, duplicate or stall writes are fixed; this list is what still stands from the 2026-09-27 review, re-checked against the code at `0359c66`. Items marked **(UI)** sit in `app/` or `src/ui/` and belong to the screen work; the rest are data-layer items.

**Critical for 1.0.0** marks an item that can book wrong data into FF3. Both such items are fixed; nothing else on this list writes wrong data, so the rest can ship after 1.0.0.

Already fixed, so not repeated below:

| Area | Fixed in |
| --- | --- |
| Queue stalls on a lost create response; creates not idempotent | `843a3a2` |
| Two syncs at once; Undo still sending; same sequence number twice | `843a3a2` |
| Server-address switching worked once per app launch | `843a3a2` |
| Edits checked only against a stale cache; two offline edits conflicting | `843a3a2` |
| Deleted accounts/categories/budgets stuck in pickers; envelope checkbox flipping back | `843a3a2` |
| First sync flooding the Inbox with old recurring transactions | `843a3a2` |
| Receipt photos in the cache folder; "Reading receipt…" forever; model output unvalidated; receipt time shifted to UTC | `0bebf70` |
| First-run "Not signed in"; pull-to-refresh on an empty list; sync freezing the UI | your commits `96a70c8`–`6624259` |
| Timezone-dependent test failing in UTC | `d201699` |
| Screen jump, dead search, "just" pill, inactive accounts shown; Discard button, amount validation, Approve guard, readable sign-in errors | `4b361d6` (screen work) |
| Conflict screen for recurring reviews; Retry on an errored receipt syncs | the merge of both branches |
| Deleted-in-FF3 transactions stay cached; full-table emptiness reads; count.tsx side effect in render | first testing pass |
| Gemini request schema (`responseJsonSchema`, the bot's prompt, synced categories/currencies); receipt loader; swipe acts on release; multi-select delete; year in Activity; old search results open; account order saved to FF3 | `a9f772c` |
| Capture preloads payee/account history; recency ordering; attachment status on synced transactions; keypad haptics; receipts return to the Inbox at once | `d7cfec0` |
| One shared `SearchField` for all six searches; Reorder as an icon | `0359c66` |

## Sync and outbox

Three gaps remain, all needing new dependencies or a migration.

- [x] **(UI) Discard on a failed operation.** The Inbox attention card offers only "Retry now", so an op that can never succeed (a 422, a deleted account) still blocks every later write. Add a Discard button calling `discardOperation(db, op.id)`; a discarded create returns to the Inbox as a draft. `app/(tabs)/index.tsx`, `AttentionCard`.
- [x] **(UI) Conflict screen ignores recurring reviews.** `app/transactions/[groupId].tsx:58` looks only for `update_transaction` and `delete_transaction`, so a `recurring_review` conflict can't be resolved. Add that kind to the filter.
- [ ] **Retry backoff.** A failing op is retried on every sync with no delay. Needs a `next_attempt_at` column on `outbox_operations`, then `npm run db:generate` and a new entry in `src/db/migrations.ts`. Blocked in the agent session because generating migrations was denied.
- [ ] **Sync when the network returns.** Brief §5.4 asks for it; nothing listens for connectivity. Needs `@react-native-community/netinfo`, calling `requestSync()` on reconnect.
- [x] **Transactions deleted in FF3's web UI stay cached.** The transaction pull only upserts, so they stay in Activity and payee history. Fix in `pullTransactionsInRange` (`src/sync/referenceData.ts`): after paging a closed date window, delete cached rows in that window that FF3 didn't return. Deletes made in the app already remove the row.
- [x] **(UI) Retry on an errored receipt should sync.** `retryError` in the Inbox resets the item to `captured` but waits for the next resume; call `requestSync()` from `src/sync/syncTrigger.ts`.
- [ ] **Background sync** (Android WorkManager via `expo-background-task`), listed as nice-to-have in the brief.

## Data correctness

The most costly remaining bug is the cash count booking wrong adjustments after offline spending.

- [x] **Critical for 1.0.0: Cash count ignores queued operations.** `app/count.tsx` compares against the last-synced FF3 balance, so counting after offline cash spending shows false drift and books a wrong adjustment. The balances were also stale with an empty queue: the full pull runs before the replay and a push sync has none, so spending that had just reached FF3 was still missing from them. Fixed: runSync re-reads asset balances after a replay that lands something and keeps a `balances_stale` flag until it does (`pullAccountBalances`). The count shows a banner with Sync now and refuses to book while transaction writes are queued or the flag is set, and checks both again at Confirm (`src/reconcile/countReadiness.ts`).
- [x] **Critical for 1.0.0: Sign-out keeps the old database and queue.** Signing in to another FF3 instance replays queued operations carrying the first instance's account IDs. Fixed in Settings, for both sign-out and a sign-in at an address not already stored: refused while any operation is queued, and when allowed, clears reference data, cached transactions, recurring reviews and the instance's sync settings. Drafts, aliases and preferences stay (`src/sync/instanceData.ts`). A new token at a stored address keeps everything.
- [ ] **Search is case-sensitive for Polish and Cyrillic.** Still open. SQLite `LIKE` folds case for ASCII only, so "żabka" won't find "Żabka". Store a `normkey`'d search column on `cached_transactions` and match against it (`src/transactions/useTransactionPage.ts`).
- [ ] **Accounts resolved by name, not ID.** Activity's account filter and the transaction detail screen match `sourceName`/`destinationName` to account names; a rename or two accounts sharing a name breaks them. Cache `source_id`/`destination_id` from FF3.
- [ ] **Only the first split is cached.** Split transactions show the first split's amount in Activity and totals.
- [ ] **Budget history never populates.** `budgetName` is always written as `null`, so payee suggestions never pre-fill a budget. Cache `budget_id` instead (`src/sync/referenceData.ts` still writes `budgetName: null`).
- [ ] **Failed migration is swallowed.** `src/db/client.ts` logs a migration error and the app keeps running on a broken schema. Show a blocking error screen with the Diagnostics log instead.
- [x] **(UI) Unvalidated amount inputs.** The currency-conversion field (`app/capture.tsx:268`), cash count (`app/count.tsx:185`) and recurring edit (`app/(tabs)/index.tsx:468`) still take raw text; a comma crashes the first two. Run each through `parseDecimalInput`.
- [x] **(UI) Recurring "Approve" has no in-flight guard.** A double-tap queues two operations.

## Performance

The coalescing `useLiveQuery`, transactional upserts and the capture preload removed the worst of it; three hot spots remain.

- [x] **(UI) Full-table reads to test for emptiness.** Inbox (`app/(tabs)/index.tsx:203`) and Activity (`app/(tabs)/activity.tsx:68`) each live-query all of `cached_transactions` just for `hasSyncedBefore`, and both tabs stay mounted. Use `lastSyncedAt` or a `.limit(1)` query. This grows worse as older history is loaded.
- [ ] **Reference rows rewritten every sync.** `pullReferenceData` upserts every account, category and budget each time because `syncedAt` always changes. Skip rows whose fields are unchanged; keep `syncedAt` fresh with one bulk update so pruning still works.
- [ ] **(UI) Whole-outbox live queries in several screens.** Inbox, Activity, transaction detail and `src/inbox/useInboxSections.ts` each read the full table; filter to `pending`/`failed` (or by kind) in SQL.
- [ ] **Full-resolution receipt photos.** Photos go to the model as multi-megabyte base64. Resize to about 1600 px (`expo-image-manipulator`) before hashing and sending: faster local parsing, cheaper Gemini calls, less memory.

## Code smells and cleanup

None of these break anything today; they make the next change harder or hide the next bug.

- [ ] **(UI) Oversized screens.** `app/capture.tsx` is now 546 lines with over 20 pieces of state; the Inbox is 621 lines. Screens also write tables and build outbox payloads inline. Move writes into `src/` functions and capture's state into a reducer hook.
- [ ] **(UI) Component kit bypassed.** Partly done: every search box now uses `src/ui/SearchField.tsx`. About 16 other text inputs are still styled inline, and category/budget/currency picker sheets are rebuilt on several screens. Add `TextField` and one shared picker sheet to `src/ui/`.
- [ ] **Status columns are plain strings.** `kind`, `state` and `status` are `text`, so TypeScript sees `string` and code casts (`as any`, `as InboxState`). Drizzle's `text({ enum: [...] })` changes types only, no SQL.
- [ ] **Stored JSON has no schema or version.** `draftJson` and `payloadJson` are parsed and cast. Queued payloads outlive app versions; add zod (or valibot) validation and a `v` field.
- [ ] **(UI) Errors disappear.** Partly done: `reportErrors` now wraps Inbox and capture actions. Most other async handlers have `try/finally` but no `catch`; failures become unhandled rejections that release builds swallow. A small `useAction()` wrapper can toast and log.
- [x] **(UI) Side effect during render.** `app/count.tsx:79` starts database reads in render; move to an effect.
- [ ] **(UI) Stale closure behind `eslint-disable`.** `app/(tabs)/activity.tsx:105`: the tab-press scroll captures the first render's sections.
- [ ] **Repetition.** Approve/edit/delete in `src/sync/recurringReview.ts` are near-copies; legacy-key migration code exists for an app with one install.
- [ ] **Loose ends.** Unused `@/*` import alias; `package.json` still named `mmyway-scaffold`; AGENTS.md says `npm run check` includes lint (it runs only tsc and jest); `docs/ARCHITECTURE.md` line 29 still calls the UI "deliberately plain".
- [x] **Gemini has no response schema.** The request now sends `responseJsonSchema` built from the synced categories and currencies, and retries without it on a 400.

## Missing infrastructure

The biggest gap is that nothing checks a push: there is no CI, and nothing tests a screen.

- [ ] **CI.** A GitHub Actions job running `npm run typecheck`, `npm run lint` and `npm test` on every push. The timezone is now pinned in `jest.config.js`, so it passes in UTC.
- [ ] **Screen-level tests.** Every bug from the first device build was on a screen, which the 250 pure-function tests can't catch. Add React Native Testing Library for screens, and one Maestro flow on a device: capture → confirm → queued → synced.
- [ ] **Crash reporting** (for example Sentry), beyond the on-device Diagnostics log.
- [ ] **Typed routes.** Turn on expo-router's `experiments.typedRoutes` so route strings like `/draft/${id}` are checked.
- [ ] **README.** There isn't one; AGENTS.md covers agents, not people.
- [ ] **Decide: Android backup.** `allowBackup` defaults to true, so the SQLite database with every cached transaction goes into Google Drive backups. Useful for a new phone; decide on purpose and set it in `app.config.js`.
- [ ] **Release APK build.** `npm run android:build:pro` fails in the agent container: Gradle can't resolve the foojay-resolver plugin through the proxy. Build locally or on EAS for now; testing so far used the dev-client APK with Metro.
- [ ] **Check: plain HTTP in release builds.** Nothing sets `usesCleartextTraffic`. If LM Studio is on `http://`, confirm a release APK can reach it, or serve it over HTTPS (for example `tailscale serve`).

## Letting other people in

Publishing the code is about a weekend of cleanup; letting other people rely on the app is a much larger step.

**Publishing the code** (others build it for their own FF3):

- [x] `LICENSE` is PolyForm Noncommercial 1.0.0, replacing Expo's template.
- [x] Personal material removed: the planning brief, design and plan docs are gone from the tree and from history, and `AGENTS.md` / `.claude/settings.json` no longer point at local paths.
- [ ] The EAS `projectId` in `app.config.js` ties builds to your Expo account.
- [ ] Loosen what is hardcoded to you: Polish number formatting in `formatMoney`, English-only text, Android-only APIs (`DateTimePickerAndroid`, iOS share target disabled), note denominations for four currencies.
- A pattern scan found no committed secrets.

**Other people actually using it:**

- [ ] Every open item in Sync and outbox and in Data correctness becomes mandatory: a stuck queue is an annoyance for you, lost financial data for someone else.
- [ ] Onboarding: a sign-out that clears local data. (Readable sign-in errors: done in `4b361d6`.)
- [ ] Privacy: a privacy policy (done: `PRIVACY.md`) and an in-app notice that receipt photos go to Google when Gemini is used; strip financial data from the shareable log.
- [ ] Distribution: Play Store needs an AAB (the production profile builds only APKs), crash reporting, translations, locale-aware money via `Intl.NumberFormat`, and tested migrations, since users won't reinstall to recover a broken schema.

## On-device checks for the pushed fixes

The tests run on a desktop SQLite driver with no real FF3, so these claims need a real phone and server.

- [ ] **Offline queue.** Queue three entries in airplane mode, go online, and confirm each arrives in FF3 exactly once.
- [ ] **Idempotency key.** Open a transaction created from the app in FF3's web UI and confirm its internal reference reads `mmyway:…`. Lost-response recovery depends on FF3 returning it and on its "Duplicate of transaction #N" message.
- [ ] **Undo window.** Confirm an entry, tap Undo within 5 seconds, and confirm nothing reaches FF3 (the post-confirm sync waits 6 seconds).
- [ ] **Receipt files.** Capture a receipt offline, clear the app's cache in Android settings, go online, and confirm the photo still uploads.
- [x] **Gemini.** Receipts parse with the Gemini key sent in a header (confirmed in the second testing pass).
- [ ] **Attach to a synced transaction.** Attach a photo from a transaction's detail screen, then confirm "Uploading…" turns into the file name and the file opens in FF3's web UI.
- [ ] **Background receipts.** Capture two receipts back to back and confirm both cards appear in the Inbox and fill in.
- [ ] **First +Add speed and keypad haptics.** After a cold start, the first capture should open as fast as later ones; digit keys should buzz on press.
