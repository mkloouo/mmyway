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

## Open — fix before merge

From [review-envelope-1.md](review-envelope-1.md) and an orchestrator check:

1. **Critical** — queued rename/delete keep the local `mmyway-*` id after `create_budget` syncs; the delete then
   skips FF3 and the envelope survives. Swap the id in queued `update_budget`/`delete_budget`/`set_budget_limits`
   payloads when the create records its server id (`src/bucket/budgetActions.ts`). Add the test.
2. **Critical** — `enqueueBudgetDelete` on an unsynced envelope drops *every* unsynced `create_budget`, not just its
   own (non-specific `where`). Filter by the payload's client id.
3. `enqueueBudgetCreate(db, name, currencyCode)` — remove `currencyCode` from signature and payload.
4. `app/budget/new.tsx`, `app/budget/[id].tsx` use raw `TextInput`; AGENTS.md requires `TextField`.

## Not started

- Envelope Maestro flow (create → rename → delete, FF3-side checks) — spec-envelope.md chunk 3
- Account create — spec-account.md (data → UI → Maestro)
- Rules surface — spec-rules.md chunks A/B/C. Seed rule must match a unique marker string, **not** "Żabka",
  or FF3 will rewrite transactions other flows create.
- Maestro flow for the existing Budget tab (Ready to Assign, assign, move, auto-fill, cover overspent, capture
  remainder) — session dialog critical path 13
- Demo/sandbox mode (roadmap §2.8) — pending your call whether it's in scope
