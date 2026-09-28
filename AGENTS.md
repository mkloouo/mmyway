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
- `npm run android:build:dev` / `npm run android:build:pro` — local EAS APK build;
  `npm run android:build:aab` — Play Store bundle
- `npm run release -- X.Y.Z` — see `scripts/release.mjs --help`
- `npm run i18n:push` / `npm run i18n:pull` — sync UI strings with Tolgee (needs `.env.local`,
  see `docs/LOCALIZATION.md`)

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
- `src/lookup/` — user aliases + merchant→category/account/budget history, pure functions.
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
- `app/` — expo-router screens: amount-first capture, an Inbox
  that behaves as an approval queue, and a shared `src/ui/` component kit every screen draws
  from — no screen inlines a literal colour, styling always goes through `useTheme()`. Text
  inputs are `TextField`, single-choice sheets `PickerSheet`, async handlers go through
  `useAction()`, and table writes live in `src/`, not in the screen. Screen tests live in
  `src/__screens__/` (never under `app/`, which expo-router would treat as routes).

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
  verbatim, see `scripts/release.mjs --help`): what they'll see, not which file changed. Put it
  under the section it belongs to (Capture, Receipts, Inbox, ...) or a `### Fixed` section. A
  fix to something not yet released doesn't get its own line — correct the existing description
  instead. Internal-only changes (refactors, tests, tooling, docs) are skipped.
- `draft_json` and `payload_json` are read and written only through `src/inbox/draftJson.ts` and
  `src/sync/payloadJson.ts` (zod-validated, versioned) — never `JSON.parse` + cast.
- After `npm run db:generate`, register the new file in `src/db/migrations.ts`;
  `src/db/migrations.upgrade.test.ts` fails if you don't.
- `src/api/ff3/types.ts` and `src/db/migrations/**/*.sql` are generated/pinned — don't hand-edit
  generated SQL migrations; edit `src/db/schema.ts` and run `npm run db:generate`.
- **Open bugs, features and cleanups are GitHub Issues** (`mkloouo/mmyway`), not checklists in
  `docs/`. File what you find but don't fix as an issue; a PR that resolves one says `Fixes #N`
  in its description so merging closes it.

RTK Golden Rule, Sub-Agents clause, and full command reference live in `~/.claude/RTK.md`
(global, loaded every session) — see there instead of duplicating it here.
