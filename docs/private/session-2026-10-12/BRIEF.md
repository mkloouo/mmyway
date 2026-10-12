# Session brief — 2026-10-12

Goal: implement what `docs/private/session-dialog-2026-10-11.md` (and the rest of `docs/private/*`)
left missing, excluding the statistics dashboard. Envelopes must be creatable, renamable and deletable.
Cover everything with unit tests and Maestro e2e.

Branch: `worktree-session-dialog-gaps` (worktree `.bare/.claude/worktrees/session-dialog-gaps`), based on
local `main` @ `841ffa3`.

## Research

- [gaps.md](gaps.md) — session dialog vs. commits b71ee85..841ffa3
- [gaps-all.md](gaps-all.md) — every `docs/private/*` requirement vs. code. Budgeting and planned-transactions
  plans: all phases DONE. Missing: account create, rules surface, insights (excluded), demo/sandbox mode (§2.8).
- [maestro-guide.md](maestro-guide.md) — how to write flows that match correctly here (tab a11y labels like
  `'Budget, tab, 4 of 5'`, `label:` for variable/regex text, coordinate taps over `back`). No budget flows exist yet;
  the seed has one budget, "Food".

## Specs (ready for implementers)

- [spec-envelope.md](spec-envelope.md) — create/rename/delete (`create_budget`, `update_budget`, `delete_budget`)
- [spec-account.md](spec-account.md) — account create incl. liability fields, archiving (`create_account`)
- [spec-rules.md](spec-rules.md) — Settings → Rules: groups + rules, active toggles, "Run now", create rule from
  transaction (`trigger_rule`, `toggle_rule_group`; rule toggles reuse `save_planned`)

Decisions already made: no currency on envelopes (FF3 budgets have none); rename conflict = alert; rule toggles
immediate, "Run now" confirms; Rules reached from Settings; group headers non-collapsible.

## Implemented (committed)

- `e3df7af` feat(budget): queue envelope create, rename and delete — data/sync layer, 16 tests.
  Notes: [impl-envelope-1.md](impl-envelope-1.md)
- `04c90d6` feat(budget): create, rename and delete envelopes — UI, screen tests, i18n, CHANGELOG.
  Notes + Maestro labels: [impl-envelope-2.md](impl-envelope-2.md)

Suite at `04c90d6`: 144 suites / 983 tests pass, typecheck and lint clean.

## Done in the follow-up session (same day)

Plan: `~/.claude/plans/please-plan-first-you-agile-possum.md`. Suite: 155 suites / 1056 tests, tsc + lint clean.

- `773e016` envelope review fixes 1–4 (optimistic row, id swap, scoped delete, no currencyCode, TextField)
- `949f6f1` Maestro B1–B3 (Budget tab); seed adds budget "Fun"
- `9ff41ff` `35befba` account create (data, screen); `f68b0db` Settings → Liabilities + liability edit/archive
- `1cf8ec0` `dc8a34a` demo mode ([spec-demo.md](spec-demo.md)); also clears bucket_objects on instance switch
- `9f7c982` `ee3d8ca` Rules (cache groups; toggle_rule / toggle_rule_group / trigger_rule / create_rule; screens)
- `d5ea78f` `9d83df4` `51b553e` Maestro T6 (loan create + archive), D1 (demo, smoke), T7 (rules); seed marker rule

## Still open

- Device run of every new flow — selectors (dialog buttons, rule Switch by index) are unverified.
- Regenerate the FF3 test snapshot: `npm run ff3:test -- fresh` (seed gained "Fun" and the marker rule).
- Liability type/direction/interest are create-only (no local columns).
- Pre-existing prettier warnings: S1-cold-start.yaml, subflows/sync.yaml, app.config.js.
