# Maestro Flow Writing Guide

## Quick Reference: Element Matching Lessons

From commits 39beae7, 3ca8404, 841ffa3, the pattern evolved:

**What went wrong:**
- **Tabs**: Plain `'Activity'` matched too broadly (any text "Activity"), breaking when multiple tabs exist. Now use accessibility labels: `'Activity, tab, 2 of 5'`
- **Text matching without context**: Using `'text'` bare in commands like `visible:` or `tapOn:` relies on text node matches; add ambiguity. Now wrap in `label:` structure for safety.
- **Regex/patterns unqualified**: Patterns like `'12[.,]34'` work in strings but need explicit `label:` wrapper when variables or special chars are involved.
- **Back button unreliability**: `back` key can go back a screen or close a sheet—use coordinate taps `point: 'X%,Y%'` instead.

**The correct pattern now:**
1. **Tabs** (always): Use accessibility label with position: `tapOn: 'Activity, tab, 2 of 5'` or `visible: 'Inbox, tab, 1 of 5'`
2. **Text with variables or patterns**: Use `label:` structure: `tapOn: label: 'S2 ${RUN_ID}'`, `assertVisible: label: '.*S3 ${RUN_ID}.*'`
3. **Coordinates instead of Back**: Use `tapOn: point: '0%,15%'` to tap top-left instead of relying on the Back key
4. **Structured selectors**: Any complex selector (ambiguous text, text with special chars, position-based) → explicit structure with `id:`, `label:`, or `point:`

---

## App Architecture for Flows

**App entry point**: `app/_layout.tsx` (loads providers, sets up context)
**Routes**: `app/(tabs)/*` (tab screens: Inbox, Activity, Planned, Budget, Settings)
**Capture**: `app/capture.tsx` (amount entry), `app/draft/[id].tsx` (detail sheet)

**No test IDs** except keypad:
- `keypad-0`, `keypad-1`–`keypad-9`, `keypad-00`, `keypad-decimal`, `keypad-backspace`, `keypad-save` (all in `src/ui/Keypad.tsx`)
- Everything else tapped by **English text from `src/i18n/locales/en.json`** or **accessibility label**

**Critical**: Renaming UI strings breaks flows. Always `grep -r "old text" .maestro/` before renaming.

---

## How Flows Are Structured

All flows live in `.maestro/flows/<area>/` with one file per checklist entry (S1, A2, R3, etc.). Files ending in `.a`, `.b`, `.c` are parts with host steps between them (see `scripts/e2e.mjs` FLOWS list for host step definitions).

### Flow anatomy:

```yaml
appId: ${APP_ID}
name: 'S2 · Capture a withdrawal'
tags:
  - smoke          # tier: picked by `npm run e2e` (smoke tests), `-- release` (all), or `-- --changed` (smoke + files changed)
---
# Always start with ready (launch + sign-in if needed + sync)
- runFlow: ../../subflows/ready.yaml

# Tap with text: bare string (simple case) or label structure (recommended for any variable/pattern)
- tapOn: 'Add an entry'
- tapOn: 
    label: '${VARIABLE_NAME}'

# Wait for something visible with precise selectors
- extendedWaitUntil:
    visible:
      id: 'keypad-1'
    timeout: 15000

# Tap by id (keypad only)
- tapOn:
    id: 'keypad-1'

# Tap by text when unambiguous (no variables or patterns)
- tapOn: 'Close'

# Tap by text WITH structure (for variables, patterns, or when you need the label accessor)
- tapOn:
    text: 'Savings EUR'
    index: 1

# Verify on-screen appearance (use label: for patterns/variables)
- assertVisible:
    label: '12[.,]34'
- assertVisible: 'TO CONFIRM'  # OK for simple text

# Hide keyboard after text input (Android Back key)
- hideKeyboard

# Conditionally tap (if on-screen or not)
- runFlow:
    when:
      visible: "Discard this entry\\?"
    commands:
      - tapOn: 'Discard'

# Call a subflow with environment variables
- runFlow:
    file: ../../subflows/capture.yaml
    env:
      AMOUNT: '12,34'
      PAYEE: 'S2 ${RUN_ID}'
      CATEGORY: ''

# Run host-side checks (Firefly III API, database reads)
- runScript:
    file: ../../scripts/ff3.js
    env:
      ACTION: findTx
      PAYEE: 'S2 ${RUN_ID}'
      EXPECT_COUNT: '0'

# Screenshots for manual inspection
- takeScreenshot: S1-activity

# Tap a specific coordinate (e.g. top-left to close a sheet without using Back)
- tapOn:
    point: 0%,15%
```

---

## Tab Navigation: The Fixed Pattern

**All tabs must be referenced by accessibility label with position:**

```yaml
# Inbox (1st tab)
- tapOn: 'Inbox, tab, 1 of 5'

# Activity (2nd tab)
- tapOn: 'Activity, tab, 2 of 5'

# Planned (3rd tab)
- tapOn: 'Planned, tab, 3 of 5'

# Budget (4th tab)
- tapOn: 'Budget, tab, 4 of 5'

# Settings (5th tab)
- tapOn: 'Settings, tab, 5 of 5'
```

**Both waiting and tapping use the same label format:**

```yaml
- extendedWaitUntil:
    visible: 'Inbox, tab, 1 of 5'
    timeout: 30000

- tapOn: 'Settings, tab, 5 of 5'
```

Renaming a tab label in the app breaks all flows using the old name—check AGENTS.md for the source of tab names in `src/i18n/locales/en.json`.

---

## Text Matching: Bare vs. Structured

### Use bare `text: '...'` only when:
- No variables or patterns
- Text is unambiguous (only one on-screen)
- No special characters that need escaping

**Examples:**
```yaml
- tapOn: 'Save'
- tapOn: 'Close'
- tapOn: 'Discard'
- assertVisible: 'TO CONFIRM'
```

### Use `label: '...'` when:
- Variable interpolation: `label: '${RUN_ID}'`
- Regex patterns: `label: '12[.,]34'`, `label: '.*S3 ${RUN_ID}.*'`
- Multiple matches (use index): `tapOn: text: 'Savings EUR', index: 1`
- After confirm/action (e.g., item that appears after save)

**Examples:**
```yaml
# Variable
- tapOn:
    label: 'S2 ${RUN_ID}'

# Pattern (regex in label)
- assertVisible:
    label: '12[.,]34'

# Pattern with variable
- assertVisible:
    label: '.*S3 ${RUN_ID}.*'

# Multiple matches: tap the 2nd one
- tapOn:
    text: 'Savings EUR'
    index: 1
```

**Inside `${...}` variables**: Avoid `{`/`}` (parser stops at first `}`). Quote any `: ` (colon-space).

---

## Subflows and Environment Variables

Common subflows (in `.maestro/subflows/`):

| Subflow | Purpose | When to use |
|---------|---------|------------|
| `ready.yaml` | Launch, sign-in link if needed, sync | Start of every flow |
| `home.yaml` | Navigate back to Inbox (the home tab) | After deep navigation |
| `capture.yaml` | Fill the capture/draft sheet with fields (AMOUNT, PAYEE, ACCOUNT, CATEGORY, DESCRIPTION, SAVE) | After opening a draft or capture sheet |
| `close-capture.yaml` | Discard the capture sheet | After saving/testing capture |
| `sync.yaml` | Trigger sync from the Inbox's status pill; wait until done | After confirms to check Firefly III receives data |
| `wait-sent.yaml` | Wait until queued items send (no "Queued N" badge) | After confirm/edit to ensure outbox is empty |
| `delete-draft.yaml` | Delete an inbox item (draft) | Clean up after a test |
| `open-transaction.yaml` | Search Activity for a description, tap it | To open a synced transaction |
| `sign-in.yaml` | Navigate to Settings, sign in via link | After sign-out (T3) |
| `set-reader.yaml` | Configure receipt reader from env (GEMINI_KEY or LOCAL_MODEL_URL) | Before receipt flows (R1–R3) |

**Passing env to a subflow:**
```yaml
- runFlow:
    file: ../../subflows/capture.yaml
    env:
      AMOUNT: '12,34'
      PAYEE: 'S2 ${RUN_ID}'
      PAYEE_NEW: 'true'
      ACCOUNT: 'Checking'
      TO_ACCOUNT: ''
      CATEGORY: ''
      DESCRIPTION: ''
      SAVE: inbox  # or 'confirm' for immediate confirmation
```

The subflow accesses variables as `${AMOUNT}`, `${PAYEE}`, etc.

---

## Host Steps (Between Flow Parts)

Complex actions the phone can't perform are host steps, run by the e2e runner between flow parts. See `scripts/e2e.mjs` for the full list:

- `share(fixture)`: Push a photo to the phone and share it into the app
- `host('backgroundJob')`: Run the WorkManager background job
- `host('cron')`: Run Firefly III's cron (books recurrences)
- `host('wifi', { on: false })`: Toggle Wi-Fi
- `host('night', { on: true })`: Toggle dark mode
- `host('logSecrets')`: Read the diagnostics log, fail if it contains the API token or key
- `host('install', { which: 'previous' })` / `which: 'current'`: Install an APK

**Example multi-part flow in FLOWS:**
```javascript
{
  id: 'P2',
  title: 'Recurring review',
  steps: [
    'planned/P2-recurring-review.a.yaml',  // Capture a recurring transaction
    host('cron'),                          // Run FF3 cron to book it
    'planned/P2-recurring-review.b.yaml',  // Verify it was booked
  ],
  areas: ['src/planned/'],
}
```

---

## Script Actions: Checking Results in Firefly III

Every flow **validates its data in Firefly III**, not just on screen. This is done with host-side `runScript` calls using `scripts/ff3.js`. The runner calls it from Node.js with env vars, so a flow can:

1. Check a transaction was created once and has the right amount/category/accounts
2. Verify syncs succeeded
3. Clean up seed data after tests

**Common FF3 actions** (see `scripts/ff3.js` for full list):

| ACTION | Purpose | Example env |
|--------|---------|-------------|
| `findTx` | Count transactions matching payee, verify count | `PAYEE: 'S2 ...', EXPECT_COUNT: '1'` |
| `expectPlanned` | Verify a bill/recurrence was created | `NAME: 'P1 ...', EXPECT_AMOUNT: '50.00'` |
| `expectAccount` | Check account name, active/inactive status | `NAME: 'Savings EUR ...', EXPECT_ACTIVE: 'false'` |
| `balance` | Get account balance | `NAME: 'Cash wallet'` → result in `${output.balance}` |
| `updateAccount` | Restore seed data (admin action) | `NAME: '...', NEW_NAME: '...', ACTIVE: 'true'` |
| `createTx` | Insert a transaction for testing | Rarely used (flows create their own data) |

**Pattern:**
```yaml
- runScript:
    file: ../../scripts/ff3.js
    env:
      ACTION: findTx
      PAYEE: 'S2 ${RUN_ID}'
      EXPECT_AMOUNT: '12.34'
      EXPECT_SOURCE: 'Checking'
      EXPECT_COUNT: '1'
      TIMEOUT_MS: '3000'
```

The script polls for up to TIMEOUT_MS; the flow fails if the check doesn't pass.

---

## Test Seed: Names Flows Rely On

The seed (`.maestro/../tools/ff3-test/seed.json`) is applied fresh before every run. Flows can rely on these names:

**Accounts:**
- `Checking` (asset, PLN, 5000.00)
- `Cash wallet` (asset, PLN, 300.00, marked `mmyway-envelope`)
- `Savings EUR` (asset, EUR, 1000.00)
- `Żabka`, `Biedronka`, `Orlen` (expense accounts)
- `Employer`, `Cash surplus` (revenue accounts)

**Categories:**
- `Groceries`, `Household`, `Fuel`, `Eating out`, `Salary`

**Budgets:**
- `Food` (envelope budget; linked to Żabka transactions)

**Bills:**
- `Internet` (79.00 PLN, monthly, repeats on the 10th)

**Reference transactions** (recurring, monthly from 6 months ago to now):
- `Salary {month}` (6500.00 PLN deposit)
- `Żabka {month}` (23.45 PLN withdrawal, tagged with budget "Food")

**Recent transactions:**
- `Cash withdrawal` (200.00 transfer, Checking → Cash wallet, 4 days ago)
- `Fuel` (250.00 withdrawal, Checking → Orlen, 3 days ago)

**Budget flows do not exist yet**—the seed has `Food` defined and used in transactions, but no e2e flow covers the Budget tab. A future flow could use the `Food` budget for envelope operations.

---

## Example: Writing a New Flow

### Scenario: Capture with a budget

1. Create `.maestro/flows/capture/C4-with-budget.yaml`:

```yaml
appId: ${APP_ID}
name: 'C4 · Capture with budget'
tags:
  - release
---
- runFlow: ../../subflows/ready.yaml

# Navigate to Inbox, open capture
- tapOn: 'Inbox, tab, 1 of 5'
- tapOn: 'Add an entry'

# Enter amount (keypad)
- extendedWaitUntil:
    visible:
      id: 'keypad-1'
    timeout: 15000
- tapOn:
    id: 'keypad-5'
- tapOn:
    id: 'keypad-0'
- tapOn:
    id: 'keypad-decimal'
- tapOn:
    id: 'keypad-0'
- tapOn:
    id: 'keypad-0'
- assertVisible:
    label: '50[.,]00'

# Fill draft via subflow
- tapOn: 'Next'
- runFlow:
    file: ../../subflows/capture.yaml
    env:
      TYPE_LABEL: ''
      AMOUNT: '50,00'
      PAYEE: 'C4 ${RUN_ID}'
      PAYEE_NEW: 'true'
      ACCOUNT: 'Checking'
      TO_ACCOUNT: ''
      CATEGORY: 'Groceries'
      DESCRIPTION: 'C4 budget test'
      SAVE: confirm

# Verify sync sent it
- runFlow: ../../subflows/wait-sent.yaml

# Check Firefly III
- runScript:
    file: ../../scripts/ff3.js
    env:
      ACTION: findTx
      PAYEE: 'C4 ${RUN_ID}'
      EXPECT_AMOUNT: '50.00'
      EXPECT_CATEGORY: 'Groceries'
      EXPECT_SOURCE: 'Checking'
      EXPECT_COUNT: '1'
      TIMEOUT_MS: '5000'

# Verify it's no longer in Inbox (confirmed → synced)
- assertNotVisible:
    label: 'C4 ${RUN_ID}'
```

2. Register in `scripts/e2e.mjs` FLOWS:

```javascript
{
  id: 'C4',
  tier: 'release',
  title: 'Capture with budget',
  steps: ['capture/C4-with-budget.yaml'],
  areas: ['app/capture.tsx', 'src/capture/', 'src/inbox/', 'app/(tabs)/budget.tsx'],
},
```

3. Run:
```bash
npm run e2e -- C4
```

4. If flows tap "Food" (the seed budget), check the string hasn't been renamed:
```bash
grep -r "Food" .maestro/
```

---

## Debugging Flows

**maestro studio**: Opens a live view hierarchy and lets you try selectors:
```bash
maestro studio
```
Then tap elements on the phone or type selectors in the studio console.

**maestro check-syntax**: Validate a flow without a phone:
```bash
maestro check-syntax .maestro/flows/smoke/S1-cold-start.yaml
```

**Screenshots**: Flows can take screenshots; results go to `e2e-results/<timestamp>/`:
```yaml
- takeScreenshot: my-screen-name
```

**Flow logs**: Each flow's Maestro log is in the results folder for debugging timeouts or selector misses.

**Common issues:**
- `visible` timeout: Element hasn't appeared in time—check `extendedWaitUntil` timeout, or selector is wrong
- `tapOn` misses: Text selector too broad (matches multiple elements) → use `label:` or `index:`
- Keyboard doesn't close: Remember `hideKeyboard` after `inputText` on Android
- Tabs don't switch: Check the exact accessibility label including position (`'Activity, tab, 2 of 5'`, not just `'Activity'`)

---

## Checklist: New Flow Dos and Don'ts

### DO:
- ✓ Start every flow with `runFlow: ../../subflows/ready.yaml`
- ✓ Use tab accessibility labels with position: `'Inbox, tab, 1 of 5'`
- ✓ Use `label:` for text with variables or regex patterns
- ✓ Call `hideKeyboard` after `inputText`
- ✓ End with a check in Firefly III via `runScript` (unless the flow only reads)
- ✓ Use meaningful RUN_ID-based names so tests clean up after themselves
- ✓ Call subflows for common patterns (capture, sync, wait-sent, delete-draft)
- ✓ Register in FLOWS with `areas` so `--changed` picks it if relevant files changed
- ✓ Use coordinate taps (`point:`) instead of `back` when Back key behavior is ambiguous
- ✓ Wrap complex payloads with `label:` even in string context: `assertVisible: label: '...'`

### DON'T:
- ✗ Hardcode UI strings—grep `.maestro/` for the old string before renaming
- ✗ Type long text (>120 chars) directly; use the sign-in link pattern instead
- ✗ Call `back` multiple times to navigate—use `runFlow: ../../subflows/home.yaml` to get to Inbox
- ✗ Rely on the Back button to close sheets reliably—use coordinate taps
- ✗ Test the camera shutter or visual aesthetics—leave those for manual screenshots
- ✗ Use test IDs except for keypad (`keypad-1`, etc.)—everything else is tapped by text
- ✗ Write flows for features without seed data—add to seed first if needed
- ✗ Forget that `${...}` cannot contain `{`/`}`—avoid nesting, or quote `: ` inside
- ✗ Use `visible:` with bare text and variables—wrap in `label:`
- ✗ Assume tap-by-text works for items with identical labels—use `index:` to pick the Nth match

---

## Budget Tab Structure (For Future Flows)

The Budget tab (`app/(tabs)/budget.tsx`, `app/budget/[id].tsx`) manages envelope budgeting over Firefly III budgets. The seed has one budget: **Food**.

**Tab features:**
- List of budget envelopes (Firefly III budgets rendered as spending envelopes)
- Assign money to an envelope for the current month
- Autofill envelopes based on last month's spending
- Move money between envelopes
- View spending per envelope vs. limit

**Strings** (in `src/i18n/locales/en.json`):
- `budget.title` → "Budget"
- `budget.envelopes` → "Envelopes"
- `budget.autofill` → button text for autofill action
- `budget.noEnvelopesTitle` / `budget.noEnvelopesHint` → empty state
- `budget.envelopeLine` → line with amount in list

**To write a Budget flow:**
1. Use `tapOn: 'Budget, tab, 4 of 5'` to navigate
2. Access the Food budget by name (seed provides it)
3. Tap "Autofill", "Assign", or "Move" actions
4. Validate in Firefly III with `ACTION: expectBudgetLimit` (if implemented in ff3.js)

No flows currently cover the Budget tab—this is a gap for future work.
