# Screen requirements

Draft for review · 2026-09-30 · checked against 1.4.6 (`5c00f67`)

What each screen must show and let you do. `docs/ARCHITECTURE.md` says how the app is built; this
file says what each screen is for.

**Reviewing.** Every requirement has an ID (`CAP-8`). To review, reply with the ID and ✓, ✗ or the
change you want. Fields are defined once (§1.1), and screens only list which ones they use.

**Status** is what 1.4.6 does: ✅ does it · 🟡 partly · ❌ doesn't · ❓ your call. Bugs are filed as
issues and linked here. A ❌ that is a new feature becomes an issue once you agree to it; after
that, this file keeps only the requirement and its issue number (AGENTS.md: open work lives in
Issues).

## Findings

What 1.4.6 gets wrong or lacks, most important first.

| #   | Finding                                                                                                                                                                                                                                                                                 | IDs                 | Issue         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------- |
| 1   | **Transaction: a plain expense or income has no Payee/Payer row**, so its payee can't be seen or changed. Split pages have one. On a draft, the payee is the heading under the amount, and nothing shows it can be tapped.                                                              | TXN-3, DRF-5        | #115          |
| 2   | **Capture is cut off** in a pop-up, split-screen or landscape window. Keys are sized from the window's width and nothing above them scrolls. Chips are 36 dp, below the kit's 44.                                                                                                       | CAP-13, G-1, G-2    | #116          |
| 3   | **A recurring income or transfer under review is drawn as an expense**, and its edit sheet changes the wrong end.                                                                                                                                                                       | INB-8               | #117          |
| 4   | **A receipt with no printed date gets the time it was read**, not when it was taken. The photo's own date is never read.                                                                                                                                                                | RCP-5, DRF-9        | #118          |
| 5   | **A receipt waiting for its reader says "Reading receipt…"**, and draft cards show a time but no date.                                                                                                                                                                                  | INB-6, INB-7        | #119          |
| 6   | **Fields the reader wasn't sure about are recorded but never marked.**                                                                                                                                                                                                                  | DRF-10              | #120          |
| 7   | **Shared with holds one name**, and editing a transaction shared with two drops one of them.                                                                                                                                                                                            | DRF-8, TXN-5        | #121          |
| 8   | **Converted amount is missing in three places.** A draft has none: #105 covers receipts, and a manual entry saved to the Inbox hides what you typed. A transaction never shows it, although it is cached. A transfer between accounts in different currencies doesn't ask what arrived. | CAP-3, DRF-3, TXN-4 | #105, to file |
| 9   | **A draft can't change type**, so a refund receipt can't become income.                                                                                                                                                                                                                 | DRF-2               | to file       |
| 10  | **Capture's "Today" is when Capture opened**, not when you saved, so a run of entries all get the first one's time.                                                                                                                                                                     | CAP-8               | to file       |
| 11  | **The phone going offline only shows after a sync fails.**                                                                                                                                                                                                                              | INB-2               | to file       |
| 12  | From your notes: location #67 and crop #70 are still open; reader and model #68 and delete photo #69 have landed (#68 on the draft only — the transaction screen still has none).                                                                                                       | —                   | —             |

## 1. Shared rules

### 1.1 Fields

| Field                | In Firefly III                                 | Rule                                                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**             | `type`                                         | Expense, Income, Transfer. Labels follow the type: Payee ↔ Payer, and which of your accounts is From or To.                                                                                                                                          |
| **Amount**           | `amount`                                       | Entered with the keypad, in the currency's decimal places, and kept as a string throughout.                                                                                                                                                          |
| **Currency**         | `currency_code`                                | Defaults to Settings → Default currency, else Firefly III's primary currency. Only currencies enabled in Firefly III.                                                                                                                                |
| **Converted amount** | `foreign_amount`, `foreign_currency_code`      | Asked for whenever the entry's currency differs from your account's: the From account of an expense, the To account of an income, and the To account of a transfer between different currencies. Shows the implied rate. Save is refused without it. |
| **Title**            | `description`                                  | Required by Firefly III. Defaults to the payee, or "A → B" for a transfer. Each split has its own Title, and the whole split has a **Group title**.                                                                                                  |
| **Payee / Payer**    | destination of an expense, source of an income | Picked from history (ranked), from search, through an alias, or created new (flagged **New payee**). Not on a transfer. **Always a labelled row you can tap**, on every screen that has it.                                                          |
| **From / To**        | your own accounts                              | Asset and liability accounts, most recently used first. An inactive account still shows on an old transaction but isn't offered for new ones.                                                                                                        |
| **Category**         | `category_name`                                | Only categories synced from Firefly III, never hardcoded. None clears it.                                                                                                                                                                            |
| **Budget**           | `budget_id`                                    | Expenses only. Firefly III ignores it on anything else.                                                                                                                                                                                              |
| **Date**             | `date`                                         | Date and time. A new entry is dated when you save it. A receipt uses the printed date, else when the photo was taken, else when it was captured.                                                                                                     |
| **Description**      | `notes`                                        | Multi-line free text.                                                                                                                                                                                                                                |
| **Shared with**      | tag `mmyway-shared-<name>`                     | One or more people, suggesting names used before (#121).                                                                                                                                                                                             |
| **Receipt**          | attachment                                     | Attach from the camera or gallery, view full screen, remove the photo, crop (#70).                                                                                                                                                                   |
| **Location**         | `latitude`, `longitude`                        | Recorded in the background; nothing waits for it (#67).                                                                                                                                                                                              |
| **Read by**          | kept on the phone                              | Which reader and model read a receipt (#68).                                                                                                                                                                                                         |

### 1.2 Which screen has which field

✎ can edit · 👁 shown · · not wanted here · 🟡 ❌ ❓ status, explained in the notes below the table

| Field            | Capture   | Draft   | Transaction | Recurring review | Planned      |
| ---------------- | --------- | ------- | ----------- | ---------------- | ------------ |
| Type             | ✎         | ❌ ¹    | 👁           | ❌ #117          | ✎            |
| Amount           | ✎         | ✎       | ✎           | ✎                | ✎            |
| Currency         | ✎         | 🟡 ²    | 👁           | 👁                | ✎            |
| Converted amount | 🟡 ³      | ✎       | ❌ ⁴        | ✎                | ❓           |
| Title            | ✎         | ✎       | ✎           | 👁                | ✎ (Name)     |
| Payee / Payer    | ✎         | 🟡 ⁵    | ❌ #115     | 🟡 ⁶             | ✎            |
| From / To        | ✎         | ✎       | ✎           | 🟡 #117          | ✎            |
| Category         | ✎         | ✎       | ✎           | ❓ ⁷             | ✎            |
| Budget           | ✎         | ✎       | ✎           | ❓ ⁷             | ❓           |
| Date             | ✎         | ✎       | ✎           | 👁                | ✎ + schedule |
| Description      | ✎ in More | ✎       | ✎           | ·                | ✎            |
| Shared with      | 🟡 #121   | 🟡 #121 | 🟡 #121     | ·                | ·            |
| Tags             | ·         | ·       | ·           | ·                | ✎ ⁸          |
| Receipt          | ✎ attach  | 🟡 ⁹    | 🟡 ⁹        | ·                | ·            |
| Location         | ❌ #67    | ❌ #67  | ❌ #67      | ·                | ·            |
| Read by          | ·         | ❌ #68  | ❌ #68 ¹⁰   | ·                | ·            |
| Splits           | ·         | ✎       | ✎           | ·                | ·            |

1. A refund receipt, or a manual entry saved as the wrong type, can't be fixed before you confirm it.
2. Only in the ⋯ menu, or on a **Pick a currency** chip when there is no currency. It should be
   tappable next to the amount.
3. Asked for on expenses and incomes only. A transfer from a PLN account to a EUR account doesn't ask
   what arrived.
4. `cached_transactions` keeps `foreign_amount`, but the screen never shows it.
5. The payee is the heading under the amount. Tapping it works, but nothing shows that it can be
   tapped (#115).
6. The card shows the title and one account. The payee isn't shown.
7. The card shows neither and can't open the transaction. ❓ Approve without seeing them, or let a
   tap on the card open the transaction screen?
8. ❓ Planned transactions have free-form tags. Transactions use tags only for Shared with. Should
   Capture, Draft and Transaction get general tags too?
9. View, attach and remove work. Crop (#70) is missing.
10. This extends #68, which covers only the draft. The transaction screen can find the reading
    through the Inbox item that created the transaction, as it already does for the local photo.

### 1.3 Every screen

- **G-1** 🟡 **Fits any window**: pop-up, split screen, landscape, 130% font. Content scrolls, and
  the main action stays pinned and is never cut off. Capture fails this ❌ (#116); the other screens
  scroll.
- **G-2** 🟡 **Tap targets are at least 44 dp** (the kit's `hitSize`). Chips are 36 dp with no
  `hitSlop` (#116).
- **G-3** ✅ **Works offline.** Screens read SQLite. A change is queued and marked (Queued chip,
  pending dot) until Firefly III has it.
- **G-4** ✅ **Loading, empty and failed look different.** Something still loading shows a spinner,
  never "—".
- **G-5** ✅ **Destructive actions** have Undo or ask for confirmation.
- **G-6** ✅ **Labels follow the type** (Payee/Payer, From/To), and every string is translated.

## 2. Inbox

Everything that still needs you, and nothing else. Tab 1.

**Status**

- **INB-1** ✅ Status pill: Syncing · Not signed in · Sync error · Offline · N queued · last sync.
  Tapping it opens the Sync sheet: every Firefly III and reader address with the one in use, the
  queued count, the last sync, the error, and **Sync now**.
- **INB-2** 🟡 The phone going offline shows at once, from the system's network state. Today it
  shows only after a sync fails.
- **INB-3** ✅ An offline banner while changes are waiting to be sent.

**Sections, in this order.** An empty section is hidden. The tab badge counts the first three.

- **INB-4** **Needs attention**
  - ✅ A draft that failed (receipt unreadable, no reader set up): the error, Retry, Discard.
  - 🟡 A queued change that failed: what it was, what it changed, the error, Retry now, Discard. It
    doesn't say when it will retry by itself or how many times it has tried.
  - ✅ A conflict: **Resolve** opens the conflict view (TXN-9).
- **INB-5** ✅ **To confirm**: manual entries and receipts.
- **INB-6** 🟡 A To confirm card shows:
  - ✅ payee (or "A → B"), amount, category or "N splits", and account;
  - ❌ date: only the time is shown (#119);
  - ✅ badges: New payee, Needs …, Shared with, and why the entry came back from the queue;
  - ❓ a 📎 when it has a photo.
- **INB-7** 🟡 A receipt in progress:
  - ✅ "Reading with Gemini…" while it is being read;
  - ❌ "Waiting for a reader" (offline, PC asleep): today this looks the same as reading (#119);
  - ✅ unreadable: it moves to Needs attention.
- **INB-8** 🟡 **Recurring to review**
  - ✅ title, amount, your account, date, and "enter what was charged" when it was planned in
    another currency;
  - ❌ income and transfers are drawn and edited as expenses (#117);
  - ✅ Approve, Edit (amount and account), Delete.
- **INB-9** ✅ **Queued**: kind, subject, what it changes, Waiting or Sending, and **Cancel**
  (a new transaction goes back to To confirm).

**Actions**

- **INB-10** ✅ Tap a card to open the draft. Swipe right to confirm, left to delete (Undo for
  5 s). Ready cards have a ✓ button. Long-press selects several to confirm or delete.
  **Confirm all (N)**.
- **INB-11** ✅ Empty states: Connect to Firefly III / Nothing synced yet / Inbox zero, with
  **＋ Add** and 📷.
- **INB-12** ✅ A floating dock with gallery, camera and **＋ Add**.
- **INB-13** ❓ **Possible duplicate**: before you confirm, flag a draft that matches a transaction
  already in Firefly III (same amount, same payee, within a day).
- **INB-14** ❓ To confirm order: by the entry's date, newest first? Today it is the order the
  entries were captured.

On "maybe there's another type": the list above covers every state the app has. Needs attention
holds errors, failed changes and conflicts. To confirm holds drafts, including receipts being read
or waiting for a reader. Then recurring reviews, then queued changes. The only new kind worth adding
is INB-13.

## 3. Capture

An entry in under ten seconds, amount first. Opens from **＋ Add** as a modal.

- **CAP-1** ✅ Type: Expense / Income / Transfer.
- **CAP-2** ✅ Amount with the keypad, and a currency picker. 🟡 Moving the currency onto the amount
  (tap "zł") would free the header row (#116).
- **CAP-3** 🟡 Converted amount, with the rate, when your account's currency differs; Save is refused
  without it. ❌ A transfer between accounts in different currencies isn't covered.
- **CAP-4** ✅ Title. Defaults to the payee, or "A → B".
- **CAP-5** ✅ Payee/Payer: six from history, 🔍 search (aliases included), create new, and a
  "books as X via alias" caption. Picking one fills in its usual category, account and budget.
  🟡 The 🔍 chip scrolls away with the row; it should be pinned (#116).
- **CAP-6** ✅ Account: the five most recent plus 🔍. A transfer has both From and To.
- **CAP-7** 🟡 Category and Budget chips. Budget also shows on income, where Firefly III ignores it.
- **CAP-8** 🟡 Date key: Today ▾ / Yesterday / pick a date and time. ❌ "Today" is stamped when Capture
  opened, not when you save.
- **CAP-9** ✅ **More**: description, shared with, receipt photo. The key shows a dot when any is set.
- **CAP-10** ❌ Location, recorded in the background (#67).
- **CAP-11** ✅ A "Needs payee" line. **Save & ✓** stays off until the entry is ready and shakes if
  pressed early. **Save to inbox** always works.
- **CAP-12** ✅ After a save, the amount clears and everything else stays for the next entry.
  Save & ✓ offers Undo.
- **CAP-13** ❌ **Layout for any window** (#116). The form scrolls above a pinned keypad, keys are
  sized from the height that's left, and the amount gets smaller in short windows:

  ```
  ┌ ✕   Expense  Income  Transfer ┐  fixed
  ├───────────────────────────────┤
  │          12,50 zł ▾           │  scrolls only when the window
  │  Title                        │  is too short; on a phone in
  │  Payee  🔍│ Biedronka  Aldi … │  portrait it doesn't need to
  │  From   🔍│ Cash  Revolut …   │  (🔍 pinned, chips scroll)
  │  Category  Budget             │
  ├───────────────────────────────┤
  │   1     2     3     ⌫         │  pinned; keys shrink to fit,
  │   4     5     6     Today ▾   │  never below 44 dp
  │   7     8     9     More      │
  │   ,     0     00    Save & ✓  │
  │         Save to inbox         │
  └───────────────────────────────┘
  ```

- **CAP-14** ❓ Your note ended at "Should have figured". What should it have?

## 4. Receipt

Photo in, screen gone. The camera opens on arrival. The dock's gallery button and Share from other
apps also land here.

- **RCP-1** ✅ The camera opens at once, or the gallery from the gallery shortcut. Share from another
  app works too.
- **RCP-2** ✅ If you cancel: Camera and Gallery tiles, plus an optional hint for the reader.
- **RCP-3** ✅ The same photo twice gives "already in your Inbox" with **Open it**.
- **RCP-4** ❌ Crop before reading (#70). The picker's own crop is the cheap version.
- **RCP-5** ❌ Keep when the photo was taken (EXIF), for the date (#118).
- **RCP-6** ❌ Keep where the photo was taken (EXIF GPS), for the location (#67).
- **RCP-7** ✅ Opened from a transaction: upload only, no reading.
- **RCP-8** ❓ A long receipt taken as two photos.

## 5. Draft

Check and fix one entry, then confirm it. Opens as a modal from an Inbox card, a queued Activity
row, or Duplicate. One editor serves manual entries and receipts.

- **DRF-1** 🟡 Amount (tap for the keypad), with the currency next to it. Today the currency is in
  the ⋯ menu.
- **DRF-2** ❌ Type switch: Expense / Income / Transfer.
- **DRF-3** ✅ Converted amount, as on Capture (#105). A manual entry saved with one keeps it and
  shows it.
- **DRF-4** ✅ Title under the payee; tap to edit. When empty it shows "Title".
- **DRF-5** 🟡 Payee/Payer as a labelled row (#115). ✅ The New payee flag, the alias caption, and
  alias learning (correcting a misread payee teaches an alias, with Undo).
- **DRF-6** ✅ From / To.
- **DRF-7** 🟡 Category, Budget (expenses only), Date, Description.
- **DRF-8** ❌ Shared with several people (#121).
- **DRF-9** ❌ Date: the printed date, else when the photo was taken, else when it was captured (#118).
- **DRF-10** ❌ "Check" marks on what the reader wasn't sure about (#120).
- **DRF-11** 🟡 Receipt: ✅ photo, full screen, item count, **Remove photo** in the viewer; ❌ crop (#70).
- **DRF-12** ✅ "Read by Gemini (gemini-3.1-flash-lite)" under the receipt card, and in Diagnostics.
- **DRF-13** ❌ Location (#67).
- **DRF-14** ✅ **Split**: a tracked total and one page per split (amount, title, payee, category,
  budget, description, shared with), sliders when the splits don't add up, and a Group title.
- **DRF-15** ✅ **Confirm** stays off until the draft is ready and says what's missing. ⋯ →
  Currency, Delete draft.
- **DRF-16** ✅ After Confirm the draft is read-only and marked Queued or Synced. Cancel sending
  works until it has been sent; once synced, it offers Open in Activity.

## 6. Activity

What happened, and a way to find it. Tab 2.

- **ACT-1** ✅ Balances: one card per account, with a pending dot. Tap a card to filter by that
  account. 🟡 Long-pressing a card opens the account, but nothing hints at that.
- **ACT-2** ✅ Filters: All / Spending / Income / Moves, and search (locally, then in Firefly III).
- **ACT-3** ✅ Days, newest first, with totals per currency. Scrolling to the end pulls older history
  from Firefly III.
- **ACT-4** ✅ A row shows the title, category · payee, amount and its split lines, plus Queued or
  Edited chips. A queued row opens as its draft.
- **ACT-5** ❓ Should a row also show: your account (when not filtered by one), the converted
  amount, 📎, shared with?
- **ACT-6** ✅ Long-press to select; delete several at once.
- **ACT-7** ✅ ⋯ → Cash count.
- **ACT-8** ❓ Filters for month or date range, and for category.

## 7. Transaction

View and change one transaction already in Firefly III. Opens from Activity or from a Needs
attention card.

- **TXN-1** ✅ Header: the type, and "synced 5 min ago" / "changes queued" / "not sent".
  Duplicate; ⋯ → Duplicate, Delete.
- **TXN-2** ✅ Amount (tap for the keypad) and title (tap to edit).
- **TXN-3** ❌ Payee/Payer row, editable (#115).
- **TXN-4** ❌ Converted amount, shown and editable.
- **TXN-5** 🟡 ✅ From / To, Category, Budget, Date, Description. 🟡 Shared with keeps only one name
  (#121).
- **TXN-6** ✅ Receipts: thumbnails, full screen, uploading / failed state, Attach another, and
  **Remove photo** in the viewer — a confirmed, queued `delete_attachment`.
- **TXN-7** ❌ Read by (#68, extended) and Location (#67).
- **TXN-8** ✅ **Split** and **Save**. Save stays off while the splits don't add up, and a save
  that changes nothing just closes.
- **TXN-9** ✅ Conflict view: what changed in Firefly III next to your change, with Keep mine /
  Use server (for a delete: Delete anyway / Keep it).
- **TXN-10** ❓ Change the type of an existing transaction? Suggestion: no. Duplicate it as the
  other type and delete the original.
- **TXN-11** ❓ An "Open in Firefly III" link to the web page.

## 8. Planned

Subscriptions and recurring transactions, handled as one thing. Tab 3.

- **PLN-1** ✅ Simple / Detailed toggle, remembered. A simple card shows name, amount, payee,
  category, schedule, next date and a pending dot. **＋** adds one.
- **PLN-2** ✅ Editor: type, name, amount, currency, From, To, category; planned on, time, repeats,
  frequency, every N; description and tags. Save stays off until something changes. Delete.
- **PLN-3** ✅ Detailed view: subscriptions, rules and recurring transactions as Firefly III has
  them, read-only.
- **PLN-4** ✅ **Book it now** on a planned transaction Firefly III holds: it fires the occurrence
  through FF3's own trigger endpoint, queued, and the booked transaction arrives in the Inbox as a
  recurring review on the next sync.
- **PLN-5** ❓ Budget; an end (until a date, or N times); converted amount; the next three dates;
  what it booked recently.

## 9. Cash count

Count the cash envelopes and book the differences. Activity ⋯ → Cash count.

- **CNT-1** ✅ Every cash-envelope account: expected balance, the counted amount (typed, or by
  denomination), Skip, and the difference.
- **CNT-2** ✅ Refuses while balances may be out of date (changes queued, or balances not re-read
  since); **Sync now**.
- **CNT-3** ✅ Review: one adjustment per envelope that differs. ⚙ sets the shortfall and surplus
  payees and an optional category.

## 10. Accounts

Settings → Accounts, or long-press a balance card in Activity.

- **ACC-1** ✅ List: search, show inactive, reorder, Inactive and Envelope chips, pending dot.
- **ACC-2** ✅ Account: balance and when it was read; name, description, currency, role, monthly
  payment date (credit cards); active, cash envelope, included in net worth; opening balance and
  its date, virtual balance.
- **ACC-3** ❓ **Show transactions**, opening Activity filtered to this account.

## 11. Settings

Tab 4.

- **SET-1** ✅ Connection: Firefly III sign-in and its addresses (the one that answers is used).
  Sign out is refused while changes are queued.
- **SET-2** ✅ Receipts: local model (name, addresses), Gemini key.
- **SET-3** ✅ Defaults: account, currency, cash payments account.
- **SET-4** ✅ Accounts; Aliases (search, add, remove, export and import); Language; About
  (version, last sync, Diagnostics with share and clear).
- **SET-5** ❌ A switch to turn location recording on or off (#67).
- **SET-6** ❓ Theme (system / light / dark); which Gemini model to use (#68 mentions its default).

## Your calls (❓), in one list

INB-6 (📎 on cards) · INB-13 (possible duplicate) · INB-14 (order) · CAP-14 (your cut-off note) ·
RCP-8 (two-photo receipts) · ACT-5 (more on a row) · ACT-8 (date and category filters) · TXN-10
(change type) · TXN-11 (Open in Firefly III) · PLN-5 (budget, end, FX, preview) · ACC-3 (Show
transactions) · SET-6 (theme, Gemini model) · §1.2 notes 7 (category on reviews) and 8 (tags on
transactions) · Planned converted amount.

<details>
<summary>Your notes, and where each went</summary>

| Your note                                                                          | IDs                     |
| ---------------------------------------------------------------------------------- | ----------------------- |
| Inbox: connectivity state                                                          | INB-1–3                 |
| Pending items, pending changes, recurring, conflict, error                         | INB-4–9                 |
| "Maybe there is another type"                                                      | INB-7 (waiting), INB-13 |
| Review: amount and currency                                                        | DRF-1                   |
| Conversion input when the account's currency differs                               | DRF-3 (#105)            |
| Title, source and destination accounts                                             | DRF-4, DRF-5, DRF-6     |
| Income named accordingly                                                           | G-6, §1.1 Payee / Payer |
| Current date and time by default                                                   | §1.1 Date, CAP-8        |
| The photo's date and time                                                          | RCP-5, DRF-9 (#118)     |
| Editable description                                                               | DRF-7                   |
| Shared with, several names                                                         | DRF-8 (#121)            |
| Which model read it, on the draft and on the transaction                           | DRF-12, TXN-7 (#68)     |
| Show the receipt, crop it                                                          | DRF-11, RCP-4 (#70)     |
| Split                                                                              | DRF-14                  |
| Capture: type, currency, foreign currency, title, description, source, destination | CAP-1–9                 |
| Capture: location                                                                  | CAP-10 (#67)            |
| "Should have figured"                                                              | CAP-14                  |
| Capture crammed on small windows                                                   | CAP-13 (#116)           |
| No way to edit an existing withdrawal's payee                                      | TXN-3, DRF-5 (#115)     |

</details>
