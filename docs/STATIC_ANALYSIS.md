# Static analysis

Free checks that catch what review would. **On:** Prettier and the strict lint (type-aware promise
rules, AGENTS.md's rules as code, hardcoded UI text) run in `npm run check` and CI as part of
`npm run lint`. **Off:** the rest below; run them by hand with `npm run analyze`, which reports
and always exits 0. Tracking issue: [#77](https://github.com/mkloouo/mmyway/issues/77).

| Command                  | Tool                                         | Finds                                                                             |
| ------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run analyze:dead`   | [knip](https://knip.dev)                     | Unused files, exports, types and dependencies                                     |
| `npm run analyze:dupes`  | [jscpd](https://github.com/kucherenko/jscpd) | Copy-paste; fails above 1% duplicated lines                                       |
| `npm run analyze:cycles` | [dpdm](https://github.com/acrazing/dpdm)     | Import cycles that exist at runtime (type-only imports are skipped)               |
| `npm run analyze:deps`   | `npm audit`                                  | High or critical advisories in what ships in the app (dev tools excluded)         |
| `npm run analyze:doctor` | `expo-doctor`                                | Expo config problems and packages off the SDK's versions                          |
| `npm run analyze`        | all of the above                             | One summary; `-- --strict` exits 1 on any finding; `-- lint cycles` runs a subset |

Config: `eslint.config.js` (Expo's rules plus the strict ones), `knip.json`, `.jscpd.json`. The manual GitHub workflow `.github/workflows/static-analysis.yml`
adds Prettier (which CI doesn't run today) and a [gitleaks](https://github.com/gitleaks/gitleaks)
scan of the history. `tools/static-analysis/dependabot.yml` is the Dependabot config, parked
outside `.github/` so it stays off.

## Baseline (2026-09-30, `main` at `c59b7a7`)

| Check  | Result                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| lint   | 36 at the time: 28 floating promises, 3 misused promises, 5 `payload_json` reads/writes outside `payloadJson.ts`; no hardcoded UI text. All fixed since (#92, #78) |
| dead   | clean since #80 (the dead exports and types are un-exported; `expo-system-ui` installed)                                                                           |
| dupes  | 0.16% (4 clones) — passes                                                                                                                                          |
| cycles | none at runtime — passes (7 through type-only imports)                                                                                                             |
| deps   | no high/critical — passes (16 moderate)                                                                                                                            |
| doctor | 5 Expo packages one patch behind the SDK (`npx expo install --check`)                                                                                              |

Most floating promises are `haptics.*()` calls, which return a promise nobody needs; making
`src/ui/haptics.ts` return `void` removes them in one go. The ones that matter are the two Undo
snackbar handlers (`app/(tabs)/index.tsx`, `app/capture.tsx`), which run outside `useAction()`, so
a failed Undo is silently dropped.

## Switching it on

In this order; each step is small and keeps `main` green.

1. **Fix the baseline**, or accept parts of it: lint is done (haptics → `void`, the Undo handlers
   in `act`, and every `payload_json` read and write through `payloadJson.ts`, so that rule is an
   error, #78); the dead exports (#80, done); `npx expo install --fix`.
2. **CI:** in `.github/workflows/static-analysis.yml` uncomment `push`/`pull_request` and change
   `npm run analyze` to `npm run analyze -- --strict`. Or fold the checks into `ci.yml` and
   `npm run check`.
3. ~~**Prettier in CI**~~ — done, in `ci.yml`.
4. **Dependabot:** `git mv tools/static-analysis/dependabot.yml .github/dependabot.yml`.
5. **GitHub settings** (no code): secret scanning with push protection; CodeQL default setup if the
   repository is public; branch protection on `main` requiring the CI checks.
