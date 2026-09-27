# mmyway

A personal Android app (`com.mkloouo.mmyway`) for the user's self-hosted Firefly III (FF3).
Replaces a Telegram capture bot. Full context: `the planning brief`
(read it before any feature work — this repo's CLAUDE.md only covers repo mechanics).

## Commands

- **`npm install` always needs `--legacy-peer-deps`** (Expo SDK 57's dependency graph has
  unresolvable peer conflicts otherwise). This has a real consequence: legacy-peer-deps mode
  skips npm's normal peer-dependency auto-install, so any package this repo's own config files
  `require()` directly — `babel-preset-expo` (from `babel.config.js`), `@react-native/jest-preset`
  (loaded internally by `jest-expo`, per `jest.config.js`'s `preset`) — must be **explicit**
  devDependencies with a pinned version, never left to hoist in as someone else's peer. If a
  future `npm install` silently drops one of these (jest suddenly fails with "Cannot find
  module 'babel-preset-expo'" or "...jest-preset"), reinstall it explicitly at the version
  `expo`/`jest-expo`'s own `package.json` declares, don't just retry the same install command.
- `npm start` — Expo dev server
- `npm run typecheck` / `npm run lint` / `npm run test` / `npm run check` (all three)
- `npm run db:generate` — regenerate Drizzle migrations after editing `src/db/schema.ts`
- `npm run android:build:dev` / `npm run android:build:pro` — local EAS APK build
- `npm run release -- X.Y.Z` — see `scripts/release.mjs --help`

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
- `src/api/ff3/` — hand-written FF3 client (fetch-based, no generated types — see note below).
- `src/sync/` — outbox (queued writes) and reference-data pulls. Read `src/sync/outbox.ts`'s
  header comment before changing replay order or retry semantics.
- `src/lookup/` — user aliases + merchant→category/account/budget history, pure functions.
- `src/suggest/` — ranks candidate values for an in-progress entry. Pure, offline, no tokens.
- `src/receipt/` — provider chain (local OpenAI-compatible model, then Gemini) that turns a
  photo into a draft. Never call a provider with a live key from a test — mock `fetch`.
- `src/inbox/` — the capture → parsed → confirmed → synced state machine shared by manual
  entries, receipts, and recurring-transaction reviews.
- `app/` — expo-router screens. Deliberately plain UI — the entry UX is still an open design
  question (brief §9 Q11); don't invest in polish here until that's settled.

## Rules

- **Never run a live write against the user's real FF3 instance or a real Gemini/local-model
  key from agent code.** Mock `fetch` in tests. This mirrors the rule in `~/Projects/my-finances/CLAUDE.md`.
- **FF3 amounts are strings.** Never parse them to `number` for storage or arithmetic — use
  `src/api/ff3/decimal.ts`.
- **Categories are never hardcoded** — always read from `src/db/schema.ts`'s
  `referenceCategories` table, synced from FF3. (The bot this app replaces hardcoded them in
  5 places; don't repeat that.)
- **Confirm is mandatory.** No code path may push a create/edit/delete to the outbox without
  the inbox item having passed through the `confirmed` state.
- `src/api/ff3/types.ts` and `src/db/migrations/**/*.sql` are generated/pinned — don't hand-edit
  generated SQL migrations; edit `src/db/schema.ts` and run `npm run db:generate`.

RTK Golden Rule, Sub-Agents clause, and full command reference live in `~/.claude/RTK.md`
(global, loaded every session) — see there instead of duplicating it here.
