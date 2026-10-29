# UI Kit V2: the rules every screen change follows

This is the contract for UI work in this repo. It applies to every contributor, human or agent
(Claude, Gemini, Codex/ChatGPT, Cursor, Copilot, …). `AGENTS.md` carries the short version; this file
is the full one.

**Design sources (read the board before you touch a screen):**

- `docs/design/kit/`: **Unified Kit V2**, three boards: cards and rows, bottom sheets, modal
  behaviour (with the today → proposed table of every screen's tier).
- `docs/design/boards/`: **Redesigns V4**, 40 screen boards (Budget, Accounts, Count cash, Capture,
  Draft review, Planned, Settings, Reminders, Activity).
- These are static HTML generated from the design canvas export with
  `node scripts/design-boards.mjs <export.html> <out-dir>`. Icons are stripped. Open one in a browser,
  or read its markup: the inline styles are the spec (sizes, colours, copy).
- **Not designed yet:** Inbox (the home tab) and Transaction detail. Don't redesign
  them on your own. Until their boards exist, a change there only follows the kit rules below.

Use the current components and changelog to check migration status before changing a screen.

## 1. The touch rule (the migration is gradual, the rule is not)

We do not rewrite whole files to reach Kit V2. But **whatever you write or change is Kit V2**:

1. **The element you touch migrates whole.** If you change a row, header, footer, sheet, button
   or list on a screen, that element ends up as the Kit V2 component (§3), with tokens and copy from
   the board. Don't patch a legacy element and leave it legacy. Don't build a half-legacy,
   half-kit hybrid.
2. **New code uses only the kit.** It uses the components in `src/ui/`, the tokens from `useTheme()`
   and the sheet and tier archetypes below. A new screen, row, sheet or state is Kit V2 from its first
   line.
3. **Untouched code may stay as it is.** A fix on line 300 doesn't oblige you to migrate line 900.
   Leave unrelated legacy code alone, and keep large refactors in separate pull requests.
4. **The kit lacks something? Add it to the kit.** Put it in `src/ui/` as a reusable component, in
   the right family file (§5), and use it. Never inline a one-off look in a screen. If it is truly
   too big for your change, describe the follow-up in the PR and use the exception marker (below).
5. **Legacy components (§3, ⛔) are never added to a place that doesn't already use them.**

### Exceptions need a real reason, in writing

Keeping legacy UI in code you touched is allowed only with a marker on the line above it:

```tsx
// kit-exception: <why the kit can't be used here>
```

**Valid reasons:**

- The kit component doesn't exist yet and is too big for this change.
- The board for this screen doesn't exist (Inbox, Transaction detail), so the target is unknown.
- Migrating this element would change behaviour that a pending design decision covers.

**Not valid:** "the rest of the file does it this way", "it was already there", "it was faster",
"consistency with the surrounding legacy code", "the kit component needs one more prop" (add the
prop).

Every `kit-exception` is listed in the PR or commit description. `grep -rn "kit-exception" app src`
is the debt ledger, and it should only shrink.

## 2. Tokens: no literal colours, sizes or fonts

`src/ui/theme.ts` (`useTheme()`) is the only source:

| Kit V2                                                                                                                                                                                       | Token                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| bg #F5F5F3, surface #FFF, surfaceAlt #EFEFEC, ink #14151A, grey #6B6F76, hairline #E3E3DF, accent #4C5BD4, accentSoft #E7E9FB, purple #7C5BD4, income, transfer, warn, danger (+ soft tints) | `t.color.*` (light and dark)                                                    |
| Spacing 4 / 8 / 12 / 16 / 20 / 24 / 32                                                                                                                                                       | `t.space.xs … xxxl`                                                             |
| Radius 8 tile, 12 button/option, 14 group, 22 sheet top, 999 chip                                                                                                                            | `t.radius.xs`, `t.radius.button`, `t.radius.md`, `t.radius.lg`, `t.radius.pill` |
| Row min height 52                                                                                                                                                                            | `ROW_HEIGHT`                                                                    |
| Touch target 44                                                                                                                                                                              | `hitSize`                                                                       |
| Type: 40/44 hero, 34/41 large title, 28/34 amount, 24/30 title, 17 heading, 15 body, 13 label/sub, 11/14 caps section header                                                                 | `t.type.display/largeTitle/amount/title/heading/body/label/caption`             |

- **Colours:** ESLint rejects a hex/rgb/hsl literal in any `.tsx`. Missing a colour? Add a token to
  both palettes in `theme.ts`. A light-only colour breaks dark mode.
- **Spacing, radii, font sizes:** use the token. A number that matches no token is either a missing
  token (add it) or drift from the board (fix it). ESLint enforces this on `app/**/*.tsx` (MKL-81).
- One font (system), `tabular-nums` on money (`<Money>`, `t.type.money`). No shadows except the FAB
  and the capture dock.

## 3. Components: which to use

The kit lives in family files under `src/ui/kit/` (each ≤ 400 lines of code) and re-exports from `src/ui/kit/index.ts`:

- `layout.tsx`: `Screen`, `SCREEN_TOP_PADDING`, `Card` (Group), `Hero`, `SectionHeader`, `GroupFooter`, `SummaryCallout`
- `rows.tsx`: `ListRow`, `SwitchRow`, `RadioRow`, `FieldRow`, `Tile`, `ROW_HEIGHT`, `PRESSED_OPACITY`
- `headers.tsx`: `PushHeader`, `ModalHeader`, `TabHeader`, `MoreButton` (deprecated `AppBar`, `BarRow`, `BarIconButton`, `CloseButton`)
- `actions.tsx`: `Button`, `Segmented`, `Chip`, `Fab`, `StickyFooter`, `ActionTile`
- `inputs.tsx`: `ChoiceCard`, `OptionTiles`, `Stepper`, `StepperRow`, `DateTile`
- `sheet.tsx`: `Sheet` (with `subtitle`), `useKeyboardHeight`
- `feedback.tsx`: `Toast`, `EmptyState`, `Dot`, `Pulse`, `StatusPill`, `Pill`, `Money`, `ProgressBar`, `NoticeBlock` (deprecated `Banner`)

✅ = Kit V2, use it. ⛔ = legacy: don't use in new or touched code; it goes away once its last use
migrates.

**Containers and rows** (kit board 1)

- ✅ `Card` (`flush`) = the **Group**: white, 1 px border, radius 14, no shadow. Three uses: ROWS
  (settings, forms, details), LIST (accounts, envelopes, planned) and HERO (one big number with its
  actions).
- ✅ `Hero`: one big number + its actions (caption, optional info button, display 40/44, optional stats row, up to 2 action buttons).
- ✅ `SummaryCallout`: `accentSoft` callout block with title 15/600 and lines 13/17 for summaries (schedule, planned payments).
- ✅ `ListRow`: label, optional subtitle, value or chevron, leading `Tile`, tone, check. Supports `struck` (faint + line-through), `selected` (bold), and `action` (trailing text button replacing value/chevron). It draws its own inset hairline (16, or 56 after a tile).
- ✅ `SwitchRow`: labelled toggle switch with optional hint and optional leading `Tile`.
- ✅ `RadioRow`: radio option with radio circle and `accessibilityRole="radio"`.
- ✅ `FieldRow`: label column (default 96 px) plus inline `TextField` or child input.
- ✅ `SectionHeader` (above a group, may carry one text action) and `GroupFooter` (footnote under a
  group).
- ✅ `Tile`: 28 px leading kind mark (envelope, savings, liability), instead of a chip.
- ✅ `DateTile`: 40 px column date tile with uppercase weekday/month (11/600) and day of month (17/700).
- ⛔ `Row` (retired and removed; use `ListRow`). ⛔ a card per row → one Group with rows.
- Rules: one row = one tap target. Labels are ink, values grey. Trailing slot holds an amount _or_ a
  chevron, never both. One helper line, never two. Switches, not checkboxes, for on/off.

**Screen tiers** (kit board 3): how a screen arrives tells you how it leaves.

- **PUSH**: a screen for something already in a list (account, envelope, planned item, Settings
  page, transaction). ✅ `PushHeader` ("‹ Back"), ✅ `SaveBar` (slides up only once something
  changed, with Undo), ✅ `MoreButton` (••• for delete and other rare actions). Leaving with changes
  asks once (`useConfirmDiscard`).
- **MODAL**: a task that makes something (Capture, Receipt, Count cash, New account in 2 steps,
  New planned in 3). ✅ `ModalHeader` (✕ top-left, step bars), ✅ `StickyFooter` (one full-width
  primary), and ✅ `ModalWizard` (multi-step frame composing header, scrolling content, problem text,
  and pinned footer with optional Back). Long tasks become steps, not one long form. Register the
  route with `MODAL` options in `app/_layout.tsx`.
- **SHEET**: one decision. ✅ `Sheet` frame: handle, 56 px header with the title on the left, optional `subtitle`, round ✕ on the right, page colour behind Groups, optional sticky footer.
  - **A · Choose** (✅ `PickerSheet`, `SearchListSheet`): search above 8 options, focused above 30,
    "Suggested" first, then A–Z with an index rail, "+ Create "…"" when typing a new name. A single
    choice closes on tap; a multi-choice footer reads "Done · 3".
  - **B · Edit** (✅ `Sheet` + `TextField` rows): fields in a Group with the label inline, help text
    above, one primary in the footer (a second action is a text button beside it). Swiping down with
    edits asks "Discard changes?".
  - **C · Review** (e.g. `SyncSheet`): status rows, each led by a status dot, with a text action when
    a row needs a fix.
  - **Sheets never stack.** A choice inside a sheet pushes within it (back chevron in its header).
- **ALERT** (`confirmDestructive` / `confirmAction`): only when there's no way back. The title is a
  question ("Delete Food?") and the button names the verb ("Delete"), never "OK".
- ⛔ `AppBar` / `BarRow` / `BarIconButton` / `CloseButton` → `PushHeader`, `ModalHeader` or the
  tab's large title. ⛔ full-screen routes for a single decision (new envelope, new rule) → sheet.

**Actions and feedback**

- ✅ `Button`: the primary in a footer. When it's blocked it shows a `hint` line saying what's
  missing; it never moves or hides.
- ✅ `ActionTile`: 3 equal bordered tiles with circle icon and label; warn tone for cover action.
- ✅ `ChoiceCard`: radio card with icon, title, subtitle, selected 2 px accent border on `accentSoft`.
- ✅ `OptionTiles`: 44 px high option tiles for 2–4 mutual exclusive choices in a radiogroup.
- ✅ `Stepper` / `StepperRow`: 36×32 −/+ controls with 18 px glyphs and tabular value; `StepperRow` includes label and unit.
- ✅ `Segmented`: transaction type and other 2–4 way switches.
- ✅ `Chip`: **only** in Activity filters and Capture's single row of ranked suggestions (which ends
  in a search button). Never a wrapping wall of chips for picking a value. That is a Choose sheet.
- ✅ `Snackbar` (with Undo) and `Toast` (short confirmation). ✅ `EmptyState`. ✅ `Dot`/`PendingDot`
  (status, queued change).
- ✅ `ProgressBar`: 6 px horizontal progress bar with radius 3; supports accent, warn, income tones.
- ✅ `Pill`: compact semantic badge with warn, income, accent, or muted tones.
- ✅ `NoticeBlock`: inline content block (replaces Banner) with icon, title 15/600, body 13/17, and optional action button.
- ⛔ `Banner`: **no banners, no jumps.** What's missing goes in the primary button's hint. A field
  the reader wasn't sure about gets the warn inset edge and a "CHECK" tag. A stale or error state
  becomes a status row (Review pattern) or the empty state.
- ⛔ raw `Pressable` / `TouchableOpacity` / `TextInput` / `Modal` in `app/`. The kit component
  owns the press opacity, hit size and accessibility. If none fits, add one to the kit.

## 4. Screens hold layout, not logic

- A screen composes kit components and calls hooks. Table reads go through a `useXxx()` hook in
  `src/<domain>/`, table writes through `src/<domain>/` functions. No drizzle query in `app/`.
- Every user-visible string comes from `src/i18n/locales/en.json` (`docs/LOCALIZATION.md`).
  Copy follows the board.

## 5. File size: no 3,000-line component files

- **A file has at most 400 lines of code** (blank lines and comments don't count). ESLint
  `max-lines` enforces it for every non-test file in `app/` and `src/`.
- Files that were already over the limit have a **ceiling** at today's size in `eslint.config.js`
  (`OVERSIZED`). They can only shrink. If your change adds lines to one, make room first by
  extracting something (a sub-component into `src/ui/`, a hook into `src/<domain>/`). Lower the
  ceiling when you shrink a file, and drop the entry once it's under 400. **Never raise a ceiling,
  and never add a new entry.**
- The kit is split by family, one file per family (rows, headers, sheets, buttons, feedback, …).
  No new `components.tsx`-style catch-all. A screen's private sub-components go in a sibling module
  once the screen nears the limit.

## 6. Checklist before you finish a UI change

1. Read the board for the screen (`docs/design/boards/`) and the kit board for the pattern.
2. Everything you touched uses ✅ components, `useTheme()` tokens and the right tier and sheet
   archetype.
3. No new ⛔ usage; each kept legacy element has a `kit-exception` with a valid reason.
4. `npm run check` passes, with no lint errors (colours, `max-lines`, strings).
5. Strings changed? Grep `.maestro/` for the old label. `CHANGELOG.md` has the user-visible change.
