# Static analysis

Free checks that catch what review would. In CI, `ci.yml` runs Prettier, typecheck, the strict lint
(type-aware promise rules, AGENTS.md's rules as code, hardcoded UI text) and the tests with a
coverage floor on the money path; `static-analysis.yml` runs the checks below on every push to
`main` and every pull request. Tracking issue: [#77](https://github.com/mkloouo/mmyway/issues/77).
`npm run analyze` runs the same checks by hand and reports without failing (`-- --strict` fails).

| Command                  | Tool                                         | Finds                                                                             |
| ------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run analyze:dead`   | [knip](https://knip.dev)                     | Unused files, exports, types and dependencies                                     |
| `npm run analyze:dupes`  | [jscpd](https://github.com/kucherenko/jscpd) | Copy-paste; fails above 1% duplicated lines                                       |
| `npm run analyze:cycles` | [dpdm](https://github.com/acrazing/dpdm)     | Import cycles that exist at runtime (type-only imports are skipped)               |
| `npm run analyze:deps`   | `npm audit`                                  | High or critical advisories in what ships in the app (dev tools excluded)         |
| `npm run analyze:doctor` | `expo-doctor`                                | Expo config problems and packages off the SDK's versions                          |
| `npm run analyze`        | all of the above                             | One summary; `-- --strict` exits 1 on any finding; `-- lint cycles` runs a subset |

Config: `eslint.config.js` (Expo's rules plus the strict ones), `knip.json`, `.jscpd.json`,
`jest.config.js` (coverage floors), `.github/dependabot.yml` (grouped, weekly). In CI the cycles,
dupes, dead-code (knip) and audit steps fail the build; expo-doctor and [gitleaks](https://github.com/gitleaks/gitleaks)
(a scan of the history) only warn, until their findings are cleared.

**Coverage floors** (`npm run test:coverage`, run by CI): `src/sync/`, `src/inbox/`, `src/splits/`
and `src/api/ff3/decimal.ts` each have a minimum for lines and branches, set a little under what
the suite covers. Raise them when the number rises.

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

## Still to do

- **GitHub settings** (no code): secret scanning with push protection; CodeQL default setup if the
  repository is public; branch protection on `main` requiring the `CI` and `Static analysis`
  checks and a pull request.
- Make the expo-doctor step fail the build once the SDK packages are current
  (`npx expo install --fix`, or Dependabot's grouped PR).
