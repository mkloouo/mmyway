# mmyway

A personal Android app (`com.mkloouo.mmyway`) for the user's self-hosted Firefly III (FF3).
Replaces a Telegram capture bot. See `docs/ARCHITECTURE.md` for the capture → confirm → sync
pipeline.

## Commands

- `npm start` — Expo dev server. **Run it against a dev build, never Expo Go.** A JS reload in
  Expo Go leaves the native SQLite handle open, so a connection stuck holding a lock survives
  what looks like restarting the app; this repo also uses config plugins Expo Go cannot apply.
- `npm run typecheck` / `npm run lint` / `npm run test` / `npm run check` (all three)
- `npm run db:generate` — regenerate Drizzle migrations after editing `src/db/schema.ts`
- `npm run ios:run:dev` — Release build of the Dev app (`com.mkloouo.mmyway.dev`) installed on the
  iOS simulator, JS bundled in, no Metro needed; regenerates `ios/` for the Dev variant first
  (`ios:clean:dev`), so a later production iOS build needs its own `expo prebuild --clean`
- `npm run android:build:dev` / `npm run android:build:pro` — local EAS APK build;
  `npm run android:build:aab` — Play Store bundle
- `npm run release -- X.Y.Z` / `npm run release -- build` — see `npx release --help`;
  the **Release** workflow runs the same script from GitHub
- `npm run ff3:test -- fresh` — a throwaway, seeded, patched Firefly III in Docker for device tests
  (`scripts/ff3-test.mjs --help`: up, reset to the seed snapshot, cron, env, destroy, …). Patches
  mounted over the image, like production, live in `tools/ff3-test/patches/`.
- `npm run e2e` / `npm run e2e -- release` / `npm run e2e -- --changed` — the device checklist as
  Maestro flows on a USB phone against that instance; see `.maestro/README.md`. When a user-visible
  string or a screen changes, grep `.maestro/` for the old label — the flows tap by text.
- `npm run analyze` — the static-analysis checks CI runs beyond `check` (dead code, copy-paste, import
  cycles, advisories, Expo config); report-only by hand. `npm run test:coverage` is the tests with
  the coverage floors (`docs/STATIC_ANALYSIS.md`)
- `npm run i18n:push` / `npm run i18n:pull` — sync UI strings with Tolgee (needs `.env.local`,
  see `docs/LOCALIZATION.md`)
- `npm run flags:sync [-- --dry-run]` — create the `src/flags/registry.ts` flags missing from Flagsmith,
  switched off (needs the admin key in `.env.local`, see `docs/FEATURE_FLAGS.md`)

## Module layout

- `src/db/` — Drizzle schema + migrations. SQLite is the source of truth for the UI.
  `client.ts` (expo-sqlite, app-facing) and `testDb.ts` (better-sqlite3, Jest-only) are
  separate files on purpose — **never merge them.** `testDb.ts` requires
  `drizzle-orm/better-sqlite3/migrator`, which imports `node:crypto`/`node:fs` at module
  scope; Metro bundles every `require()`/`import` it finds in any file reachable from the
  app entry point, lazy or not, so if that ever ends up in a file `app/`/`src/providers/`
  imports (directly or transitively), the Android bundle fails with "attempted to import the
  Node standard library module". Confirmed on a real device build. Test files import
  `createTestDb` from `./testDb` (or `../db/testDb`), never from `./client`.
- `src/providers/` — `DbProvider.tsx` (exposes the drizzle db via context, `useDb()`) and
  `queryClient.ts` (TanStack Query client), both consumed only by `app/_layout.tsx`. **Never
  name this directory `src/app`** — expo-router treats `src/app/` as an alternate routes root
  (a documented convention for projects that put everything under `src/`), so a `src/app/`
  full of plain helper files gets scanned as routes too, crashing every screen with
  "Element type is invalid... forgot to export your component" for each non-route file in
  it. Confirmed on a real device run.
- `src/i18n/` — i18next setup, `locales/*.json` (en is the source of truth; others are pulled
  from Tolgee), and `LocaleSync` (applies Settings → Language). See `docs/LOCALIZATION.md`.
- `src/api/ff3/` — hand-written FF3 client (fetch-based, no generated types — see note below).
- `src/sync/` — outbox (queued writes) and reference-data pulls. Read `src/sync/outbox.ts`'s
  header comment before changing replay order or retry semantics.
- `src/lookup/` — merchant→category/account/budget history, pure functions.
- `src/suggest/` — ranks candidate values for an in-progress entry. Pure, offline, no tokens.
- `src/receipt/` — provider chain (local OpenAI-compatible model, then Gemini) that turns a
  photo into a draft. Never call a provider with a live key from a test — mock `fetch`.
- `src/splits/` — split transactions: the tracked total and slider allocation (`allocate.ts`,
  minor units as BigInt) and the detail screen's split model (`editSplits.ts`). A split edit sends
  every split; a removed split is deleted by its journal id (a PUT leaving it out doesn't).
- `src/planned/` — the Planned tab: FF3 bills/rules/recurrences cached in `planned_objects`, the
  simple view's name-matched trio (`model.ts`), and their queued save/delete (`replay.ts`).
- `src/inbox/` — the capture → parsed → confirmed → synced state machine shared by manual
  entries, receipts, and recurring-transaction reviews.
- `src/e2e/` + `app/e2e-sign-in.tsx` — the Dev build's sign-in link for the Maestro flows
  (`mmyway-dev://e2e-sign-in?host=…&token=…`), so a flow doesn't type a thousand-character token
  key by key. It answers only when `extra.appVariant` is `development`/`preview`, and only the Dev
  build has the `mmyway-dev` scheme. **Never widen that:** a link that signs the app in to any
  server is a way to point a real install at someone else's Firefly III.
- `app/` — expo-router screens: amount-first capture, an Inbox
  that behaves as an approval queue, and a shared `src/ui/` component kit every screen draws
  from — no screen inlines a literal colour, styling always goes through `useTheme()`. Text
  inputs are `TextField`, single-choice sheets `PickerSheet`, async handlers go through
  `useAction()`, and table writes live in `src/`, not in the screen. Screen tests live in
  `src/__screens__/` (never under `app/`, which expo-router would treat as routes).

## UI: Unified Kit V2 (read `docs/UI_KIT.md` before any UI change)

The app is migrating, screen by screen, to **Unified Kit V2** (`docs/design/kit/`) and the **V4
screen boards** (`docs/design/boards/`). These rules apply to every agent and every UI change:

- **The touch rule.** No whole-file rewrites are required, but **every element you add or change
  (row, header, footer, sheet, button, list, state) ends up Kit V2 as a whole**: the ✅ components
  listed in `docs/UI_KIT.md` §3, `useTheme()` tokens, the board's copy and the right tier (PUSH /
  MODAL / SHEET A·B·C / ALERT). Leave untouched code alone, and don't patch a legacy element so it
  stays legacy.
- **Reuse before you write.** Use what `src/ui/` already has. If it lacks something, add a reusable
  component to the kit (in the right family file) instead of styling a one-off in a screen. Never
  add a ⛔ legacy component (`Banner`, `Row`, `AppBar`, a card per row, a raw `Pressable`/`TextInput`
  in `app/`, a wall of chips) where it isn't already used.
- **No literals.** Colours, spacing, radii and type come from `useTheme()`. ESLint rejects colour
  literals in `.tsx`. If a token is missing, add it to both palettes in `src/ui/theme.ts`.
- **Exceptions are rare and written down.** Keeping legacy UI in touched code needs
  `// kit-exception: <reason> (<issue>)` on the line above it, and a valid reason (the kit
  component or the board doesn't exist yet, or a pending design decision covers it). "The file
  already does it this way" is never a valid reason. List every exception in the PR description.
- **No dump files.** At most 400 lines of code per file (ESLint `max-lines`). Files already over
  it are pinned at their current size in `eslint.config.js` (`OVERSIZED`). They may only shrink, so
  extract before you add. Never raise a ceiling or add an entry.
- **Inbox and Transaction detail have no board yet** (Linear MKL-70). Follow the kit rules there,
  but don't invent a redesign.

## Feature flags (self-hosted Flagsmith, `docs/FEATURE_FLAGS.md`)

- **Anything unfinished, not yet working, or new ships behind a flag that defaults to off.** Add it
  to `src/flags/registry.ts` (same name as the Flagsmith feature) and read it with
  `useFlag('name')`, or `isFlagOn(db, 'name')` outside React. The basics stay unflagged: sign-in,
  Capture → Inbox → sync, Activity and Transaction detail, Receipts, Splits, Accounts (list and
  edit), Planned and reminders, Count cash.
- A flag hides **entry points** (tab, row, button, link) and redirects its routes. It never
  deletes data. A safety behaviour the user already turned on keeps working while its flag is off
  (an enabled app lock still locks, saved proxy headers are still sent).
- Never call a live Flagsmith from tests. Mock `fetch`, like for Firefly III.
- When a feature is done and on for good, delete the flag from the registry, the code and
  Flagsmith.

## Rules

- **Never run a live write against the user's real FF3 instance or a real Gemini/local-model
  key from agent code.** Mock `fetch` in tests. This mirrors the rule in `~/Projects/my-finances/CLAUDE.md`.
- **FF3 amounts are strings.** Never parse them to `number` for storage or arithmetic — use
  `src/api/ff3/decimal.ts`.
- **No user-visible string is hardcoded in a screen or component** — add it to
  `src/i18n/locales/en.json` (and the same key, empty, to every other locale file) and read it
  with `const { t: tr } = useTranslation()` (`t` is already the theme), or `i18n.t` outside
  React. Format dates with `appLocale()`, never `undefined`. See `docs/LOCALIZATION.md`.
- **Categories are never hardcoded** — always read from `src/db/schema.ts`'s
  `referenceCategories` table, synced from FF3. (The bot this app replaces hardcoded them in
  5 places; don't repeat that.)
- **Confirm is mandatory.** No code path may push a create/edit/delete to the outbox without
  the inbox item having passed through the `confirmed` state.
- **Every change a user could notice, minor to major, goes in `CHANGELOG.md` under
  `[Unreleased]`** in the same commit — a new feature, a changed behaviour, a fixed bug, a
  visual tweak. Write it for the person installing the app (it becomes the release notes
  verbatim, see `npx release --help`): what they'll see, not which file changed. Put it
  under the section it belongs to (Capture, Receipts, Inbox, ...) or a `### Fixed` section. A
  fix to something not yet released doesn't get its own line — correct the existing description
  instead. Internal-only changes (refactors, tests, tooling, docs) are skipped.
- `draft_json` and `payload_json` are read and written only through `src/inbox/draftJson.ts` and
  `src/sync/payloadJson.ts` (zod-validated, versioned) — never `JSON.parse` + cast.
- After `npm run db:generate`, register the new file in `src/db/migrations.ts`;
  `src/db/migrations.upgrade.test.ts` fails if you don't.
- `src/api/ff3/types.ts` and `src/db/migrations/**/*.sql` are generated/pinned — don't hand-edit
  generated SQL migrations; edit `src/db/schema.ts` and run `npm run db:generate`.
- **Open bugs, features and cleanups are Linear issues** (team **MKL**, workspace `mkloouo`), not
  checklists in `docs/` and **not GitHub Issues** (no longer used; the old `#N` references in
  code comments and docs point at closed history). File what you find but don't fix as a Linear
  issue in the matching project; a branch or PR that resolves one names it (`MKL-123`, or Linear's
  branch name) so the integration links and closes it.

RTK Golden Rule, Sub-Agents clause, and full command reference live in `~/.claude/RTK.md`
(global, loaded every session) — see there instead of duplicating it here.

## Parallel work protocol

Linear + git worktrees, local only. Agents never push; the owner pushes.

Linear: team \`MKL\`. Main checkout: \`/Users/mkloouo/Projects/mmyway/main\` (branch \`main\`).

Worktrees: \`.worktrees/<ID>\` inside the repo (gitignored). Branch: the issue ID in uppercase, e.g. \`MKL-12\`. All git steps go through \`scripts/wt.sh\`.

1. _Pick._ If given an issue ID, use it. Otherwise pick an issue that is \`Todo\` + \`agent-ready\` + all blockers \`Done\`; highest Linear priority first (Urgent → Low), then lowest issue number. Read the whole issue: Goal, Owns, Namespace, Depends on, Spec, Check, Test plan, Out of scope.
2. _Claim (the lock)._ From the main checkout: \`scripts/wt.sh start <ID>\`. Exit 2 (\`ALREADY CLAIMED\`) means another agent owns the issue; pick a different one. The last line is \`WORKTREE: <path>\`; work only there. In Linear: state \`In Progress\`, assign yourself if possible, comment \`Claimed by <agent/model name> · branch <ID> · worktree .worktrees/<ID>\`.
3. _Work._ Only inside your worktree. Edit only files matching the issue's **Owns** list (plus new files inside those folders, your namespace files, and one line in \`CHANGELOG.md\`). If you need a change outside Owns, do not make it: comment the exact change on the issue, then stop as Blocked. Commit often; message format \`<ID>: <imperative summary>\`.
4. _Verify._ \`scripts/wt.sh check\` (runs \`npm run check\`, must print \`CHECK OK\`). Run the issue's Check command too.
5. _Changelog._ Add one bullet under \`## [Unreleased]\` → \`### Added\` (or \`Changed\`/\`Fixed\`) in \`CHANGELOG.md\`, ending with \`(<ID>)\`.
6. _Integrate._ Inside the worktree: \`scripts/wt.sh finish <ID>\`. It refuses uncommitted changes (exit 3) and rebases on main; on a conflict (exit 5) it aborts and lists the files. \`CHANGELOG.md\` uses git's union merge (\`.gitattributes\`), so its bullets should never conflict; if one does, keep both sides and check that no conflict markers remain. The merge into main is fast-forward only and needs a clean main checkout (exit 6 = Blocked). Never stash or discard someone else's changes.
7. _Close._ \`finish\` removes the worktree and branch. In Linear: state \`In Review\` (or \`Done\` per team settings), and a comment with: summary of changes, files changed, check output tail, and a numbered **manual test plan** for the owner (what to open, what to tap/swipe, what to expect). The owner tests on a phone and then moves the issue to \`Done\`.
8. _Blocked._ Comment the reason and the exact unblocking change in Linear. Set state back to \`Todo\`, remove label \`agent-ready\`, add label \`blocked\`. Leave the worktree and branch for inspection. Stop.
9. _Never:_ force-push or rewrite \`main\`; commit in the main checkout except via \`wt.sh finish\`; touch another agent's worktree or branch; edit files outside Owns; commit secrets or \`.env.local\`; start dev servers or drive the app to test UI. Leave UI testing to the owner via the test plan.
