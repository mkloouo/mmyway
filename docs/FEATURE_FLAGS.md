# Feature flags

Feature flags let an unfinished or misbehaving feature be switched off without a release.

**Rule:** anything unfinished or not working ships behind a flag that defaults to **off**. The
basics stay unflagged. A flag hides an _entry point_ (a tab, a button, a settings row), and each
flag's description below says what "off" means.

The flags live in `src/flags/registry.ts`. What "off" means for each one:

- `budget`: Budget tab and envelopes (Ready to assign, sinking funds, auto-fill)
- `account_create`: Creating an account or a loan/debt from the app
- `demo_mode`: "Try it with sample data" (demo) entry point
- `app_lock`: The "Lock the app" setting
- `record_location`: Recording where a transaction was made
- `payee_nicknames`: Settings → Payee nicknames (aliases) page
- `ff3_rules`: Settings → Rules page
- `reverse_proxy`: Settings → Your Firefly III → Reverse proxy page

## Self-hosting Flagsmith

The app reads flags from a self-hosted [Flagsmith](https://docs.flagsmith.com/deployment/hosting/locally-api).

1. Run Flagsmith (see the link above for the Docker setup) and open its web UI.
2. Create one project called `mmyway`, with environments such as `Development` and `Production`.
3. Create the features with `npm run flags:sync` (below). It makes one boolean **Feature** per
   `FLAGS` key, same name, switched off.
4. Set two values in the build environment (EAS environment variables per build profile, or
   `.env.local` for local dev, which Expo loads; EAS builds don't upload `.env.local`):
   - `FLAGSMITH_API_URL`: the API root, `https://<host>/api/v1`
   - `FLAGSMITH_ENVIRONMENT_KEY`: the environment's **client-side** key. It is safe to ship in the app.

`app.config.js` reads both into `extra.flagsmith`. If either is empty, the app never calls Flagsmith
and uses the code defaults.

## Creating flags in Flagsmith: `npm run flags:sync`

`scripts/flags-sync.mjs` creates every `FLAGS` key the project doesn't have yet, switched off. It
never deletes or switches anything. It reports descriptions that differ (`~`) and features that
exist only in Flagsmith (`?`). It needs two more values in `.env.local` (see `.env.example`):

- `FLAGSMITH_ADMIN_API_KEY`: an **Organisation API key** (Organisation settings → API Keys). It can
  change everything, so it stays in `.env.local` and never goes in the app or EAS.
- `FLAGSMITH_PROJECT_ID`: leave it empty on the first run and the script lists the projects the key
  can see.

Run `npm run flags:sync -- --dry-run` first to see what it would create.

## Adding a flag

1. Add it to `FLAGS` in `src/flags/registry.ts` with a **safe default** (`false` for anything new).
   Write a one-line description of what "off" means.
2. Run `npm run flags:sync` to create it in Flagsmith (off).
3. Read it in React with `useFlag('name')`, or in non-React code with `await isFlagOn(db, 'name')`.
   Both live in `src/flags/useFlag.ts`.

## Removing a flag

When the feature is done and on for good, remove the flag: delete it from `FLAGS`, remove the
`useFlag` checks, then delete the feature in Flagsmith.

## Offline behaviour

- Flags are cached in the app's local database (`app_settings`, keys `feature_flags` and
  `feature_flag_overrides`), so they work offline.
- The app refreshes the cache on launch and each time it returns to the foreground, at most once a
  minute. A failed refresh keeps the cache.
- If the app has never fetched flags (no Flagsmith configured, or never online), every flag reads as
  its code default.
