# Screen requirements

Draft for review · 2026-10-12 · checked against the Unreleased redesign on 1.12.0 (`f22b312`)

What each screen must show and let you do. `docs/ARCHITECTURE.md` says how the app is built; this
file says what each screen is for.

**Reviewing.** Every requirement has an ID (`CAP-8`). To review, reply with the ID and ✓, ✗ or the
change you want. Fields are defined once (§1.1), and screens only list which ones they use.

**Status** is what the app does now: ✅ does it · 🟡 partly · ❌ doesn't · ❓ your call. Bugs are filed
as issues and linked here. A ❌ that is a new feature becomes an issue once you agree to it; after
that, this file keeps only the requirement and its issue number (AGENTS.md: open work lives in
Issues). Findings that the code now fixes are removed from the table below; their requirements carry
the status.

## Findings

What the app still gets wrong or lacks, most important first.

| #   | Finding                                                                                                                                                | IDs               | Issue         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------- |
| 1   | **A transaction never shows its converted amount**, although the cache keeps it.                                                                       | TXN-4             | to file       |
| 2   | **A recurring income or transfer under review is drawn as an expense**, and its edit sheet changes the wrong end. #117 is closed; not re-checked here. | INB-8             | #117 (closed) |
| 3   | **Capture's chips are 32 dp**, below the kit's 44. The #116 fix covered the layout, not the chip size.                                                 | CAP-5, CAP-7, G-2 | to file       |
| 4   | **A To confirm card shows a time but no date** (#119 is closed; not re-checked here).                                                                  | INB-6             | #119 (closed) |
| 5   | **A transaction doesn't show which reader read its receipt.** #68 covers the draft only.                                                               | TXN-7             | to file       |
| 6   | **A draft can't change type**, so a refund receipt can't become income.                                                                                | DRF-2             | to file       |
| 7   | **The phone going offline only shows after a sync fails.**                                                                                             | INB-2             | to file       |
| 8   | **Picked or shared photos don't use their own EXIF GPS** for the location.                                                                             | RCP-6             | to file       |
| 9   | From your notes: crop #70 is still open. Delete photo #69, reader and model #68 and location #67 have landed.                                          | RCP-4, DRF-11     | #70           |

## 1. Shared rules

### 1.1 Fields

| Field                | In Firefly III                                 | Rule                                                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**             | `type`                                         | Expense, Income, Transfer. Labels follow the type: Payee ↔ Payer, and which of your accounts is From or To.                                                                                                                                          |
| **Amount**           | `amount`                                       | Entered with the keypad, in the currency's decimal places, and kept as a string throughout.                                                                                                                                                          |
| **Currency**         | `currency_code`                                | Defaults to Settings → Default currency, else Firefly III's primary currency. Only currencies enabled in Firefly III.                                                                                                                                |
| **Converted amount** | `foreign_amount`, `foreign_currency_code`      | Asked for whenever the entry's currency differs from your account's: the From account of an expense, the To account of an income, and either account of a transfer between different currencies. Shows the implied rate. Save is refused without it. |
| **Title**            | `description`                                  | Required by Firefly III. Defaults to the payee, or "A → B" for a transfer. Each split has its own Title, and the whole split has a **Group title**.                                                                                                  |
| **Payee / Payer**    | destination of an expense, source of an income | Picked from history (ranked), from search, through an alias, or created new (flagged **New payee**). Not on a transfer. **Always a labelled row you can tap**, on every screen that has it.                                                          |
| **From / To**        | your own accounts                              | Asset and liability accounts, most recently used first. An inactive account still shows on an old transaction but isn't offered for new ones.                                                                                                        |
| **Category**         | `category_name`                                | Only categories synced from Firefly III, never hardcoded. None clears it.                                                                                                                                                                            |
| **Budget**           | `budget_id`                                    | Expenses only. Firefly III ignores it on anything else.                                                                                                                                                                                              |
| **Date**             | `date`                                         | Date and time. A new entry is dated when you save it. A receipt uses the printed date, else when the photo was taken, else when it was captured.                                                                                                     |
| **Description**      | `notes`                                        | Multi-line free text. On a transaction it sits in the Note sheet with tags and shared with.                                                                                                                                                          |
| **Tags**             | `tags`                                         | Free text chips, with suggestions from recent tags. On Capture and on a transaction; not on a draft.                                                                                                                                                 |
| **Shared with**      | tag `mmyway-shared-<name>`                     | One or more people, separated by commas, suggesting names used before.                                                                                                                                                                               |
| **Receipt**          | attachment                                     | Attach from the camera or gallery, view full screen, remove the photo, crop (#70).                                                                                                                                                                   |
| **Location**         | `latitude`, `longitude`, `zoom_level`          | The phone's position while Capture or the camera is open, at "balanced" accuracy; nothing waits for it, and Settings → **Record where it was made** turns it off. Every split of a group gets the same pin.                                          |
| **Read by**          | kept on the phone                              | Which reader and model read a receipt (#68).                                                                                                                                                                                                         |

### 1.2 Which screen has which field

✎ can edit · 👁 shown · · not wanted here · 🟡 ❌ ❓ status, explained in the notes below the table

| Field            | Capture            | Draft   | Transaction     | Recurring review | Planned      |
| ---------------- | ------------------ | ------- | --------------- | ---------------- | ------------ |
| Type             | ✎                  | ❌ ¹    | ✎ ¹¹            | ❌ #117          | ✎            |
| Amount           | ✎                  | ✎       | ✎               | ✎                | ✎            |
| Currency         | ✎                  | 🟡 ²    | 👁               | 👁                | ✎            |
| Converted amount | ✎ ³                | ✎       | ❌ ⁴            | ✎                | ❓           |
| Title            | ✎                  | ✎       | ✎               | 👁                | ✎ (Name)     |
| Payee / Payer    | ✎                  | 🟡 ⁵    | ✎               | 🟡 ⁶             | ✎            |
| From / To        | ✎                  | ✎       | ✎               | 🟡 #117          | ✎            |
| Category         | ✎                  | ✎       | ✎               | ❓ ⁷             | ✎            |
| Budget           | ✎                  | ✎       | ✎               | ❓ ⁷             | ❓           |
| Date             | ✎                  | ✎       | ✎               | 👁                | ✎ + schedule |
| Description      | ✎ (title), Details | ✎       | ✎ (title), Note | ·                | ✎            |
| Shared with      | ✎                  | ✎       | ✎               | ·                | ·            |
| Tags             | ✎ in Details       | ·       | ✎ in Note       | ·                | ✎ ⁸          |
| Receipt          | ✎ attach           | 🟡 ⁹    | 🟡 ⁹            | ·                | ·            |
| Location         | ✓ auto             | ✓ shown | ·               | ·                | ·            |
| Read by          | ·                  | ✅      | ❌ ¹⁰           | ·                | ·            |
| Splits           | ·                  | ✎       | ✎               | ·                | ·            |

1. A refund receipt, or a manual entry saved as the wrong type, can't be fixed before you confirm it.
2. Only in the ⋯ menu, or on a **Pick a currency** chip when there is no currency. It should be
   tappable next to the amount.
3. Asked for on expenses, incomes, and transfers between accounts in different currencies.
4. `cached_transactions` keeps `foreign_amount`, but the transaction screen never shows it.
5. The payee is the heading under the amount on a draft. Tapping it works, but nothing shows that it
   can be tapped.
6. The card shows the title and one account. The payee isn't shown.
7. The card shows neither and can't open the transaction. ❓ Approve without seeing them, or let a
   tap on the card open the transaction screen?
8. ❓ Capture and the transaction screen have tags now; the draft doesn't. Should the draft get them
   too?
9. View, attach and remove work. Crop (#70) is missing.
10. #68 covers the draft. The transaction screen can find the reading through the Inbox item that
    created the transaction, as it already does for the local photo.
11. Only on a single transaction. A split's kind is fixed, because every split has its own ends.

### 1.3 Every screen

- **G-1** 🟡 **Fits any window**: pop-up, split screen, landscape, 130% font. Content scrolls, and
  the main action stays pinned and is never cut off. Capture's fields scroll above a pinned keypad
  and buttons; not yet checked in a pop-up or landscape window.
- **G-2** 🟡 **Tap targets are at least 44 dp** (the kit's `hitSize`). Keys and the search button
  meet it; the chips are 32 dp (CAP-5, CAP-7).
- **G-3** ✅ **Works offline.** Screens read SQLite. A change is queued and marked (Queued chip,
  pending dot) until Firefly III has it.
- **G-4** ✅ **Loading, empty and failed look different.** Something still loading shows a spinner,
  never "—".
- **G-5** ✅ **Destructive actions** have Undo or ask for confirmation.
- **G-6** ✅ **Labels follow the type** (Payee/Payer, From/To), and every string is translated.

### 1.4 Screen tiers and sheets

The kit (`src/ui/kit.tsx`, `src/ui/components.tsx`) gives every screen one of three tiers.

- **PUSH**: a page you open from a list (an account, an envelope, a transaction, a planned payment,
  a Settings page). "‹ Back" in accent, a Save bar at the bottom that appears only once something
  changed (Undo beside Save), and rare actions behind •••.
- **MODAL**: a task that creates something (Capture, Count cash, New account, New planned payment,
  Receipt, Draft). ✕ top left, one sticky primary button at the bottom, and step bars when the flow
  has more than one screen.
- **SHEET**: a single decision on top of the screen. Every "choose one" is a **Choose** sheet (the
  search appears above 8 options, a letter index above 30, and "Suggested" comes first). **Edit**
  sheets hold one field (the keypad, a note, a schedule). **Review** sheets list what will happen
  before a confirm (the count adjustments).

Within a screen, a list's rows sit in one white card, with a section header above it and a
footnote under it.

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
  - ❌ date: only the time is shown (#119 is closed; not re-checked here);
  - ✅ badges: New payee, Check reading, Shared with, and why the entry came back from the queue;
  - ❓ a 📎 when it has a photo.
- **INB-7** ✅ A receipt in progress:
  - ✅ "Reading receipt with <provider>…" while it is being read;
  - ✅ "Waiting for a receipt reader · tries again on the next sync" when offline or the PC is asleep;
  - ✅ unreadable: it moves to Needs attention.
- **INB-8** 🟡 **Recurring to review**
  - ✅ title, amount, your account, date, and "enter what was charged" when it was planned in
    another currency;
  - ❌ income and transfers are drawn and edited as expenses (#117 is closed; not re-checked here);
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

The top row is ✕ and a three-way switch for the type. Under the amount are three pills: the
currency, the date, and **Details**. Each field is one row: a grey label, one row of suggestion
chips that scrolls sideways, and a 🔍 button pinned at the row's end that opens the full Choose sheet.
The two buttons at the bottom are **To inbox** and **Save & confirm**.

- **CAP-1** ✅ Type: Expense / Income / Transfer, as a switch at the top.
- **CAP-2** ✅ Amount with the keypad. The currency is a ▾ pill under the amount, and its sheet is a
  Choose sheet.
- **CAP-3** ✅ Converted amount, with the implied rate, when the entry's currency differs from the
  account's, on expenses, incomes and transfers. Save is refused without it. The row names the
  account that was paid ("Account paid").
- **CAP-4** ✅ Title: a row at the top of the card. Defaults to the payee, or "A → B".
- **CAP-5** 🟡 Payee/Payer: six from history as chips, 🔍 pinned at the row's end (search covers
  aliases), create new from the sheet, and a "books as X via alias" caption. Picking one fills in its
  usual category, account and budget. The chips are 32 dp (G-2).
- **CAP-6** ✅ Account: the five most recent as chips plus a pinned 🔍. A transfer has both From and
  To.
- **CAP-7** 🟡 Category and Budget rows, chips plus 🔍. Budget also shows on income, where Firefly III
  ignores it. The line under the card says what the chosen envelope has left this month, in red when
  it is over.
- **CAP-8** ✅ Date pill: Today ▾ / Yesterday / Pick a date and time. "Today" is read when you save,
  not when Capture opened.
- **CAP-9** ✅ **Details** sheet: notes, tags, shared with, and the receipt photo (attach, or remove).
  The pill shows a dot when any of it is set.
- **CAP-10** ✅ Location: a position is asked for as Capture opens and whatever has arrived by the
  time you save goes on the entry. Nothing waits for it.
- **CAP-11** ✅ A "Needs payee" line under the amount, and the row it's about gets a warn bar.
  **Save & confirm** stays off until the entry is ready. **To inbox** works whenever the conversion
  is complete.
- **CAP-12** ✅ After a save, the amount floats away and clears, and everything else stays for the
  next entry. Save & confirm shows a snackbar with Undo; To inbox shows a toast.
- **CAP-13** 🟡 **Layout for any window** (#116). The header, amount and pills stay put. The field
  card scrolls when the window is short, the keypad's keys are sized to what's left and never go
  below 44 dp, and the two buttons stay pinned. Built, but not yet checked in a pop-up, split screen
  or landscape:

  ```
  ┌ ✕  [Expense | Income | Transfer] ┐  fixed
  │           12,50                 │  amount
  │  Needs payee (when typed, not ready)
  │  [EUR ▾]  [Today ▾]  [Details •] │
  ├─────────────────────────────────┤
  │ Title    Lunch                  │  scrolls when the
  │ Payee    (Biedronka) (Aldi)  🔍 │  window is short
  │ From     (Cash) (Revolut)    🔍 │
  │ Category (None)              🔍 │
  │ Budget   (None)              🔍 │
  ├─────────────────────────────────┤
  │   1     2     3     ⌫           │  pinned; keys
  │   4     5     6                 │  never below 44 dp
  │   7     8     9                 │
  │   ,     0     00                │
  │ [ To inbox ] [ Save & confirm ] │  pinned
  └─────────────────────────────────┘
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
- **RCP-5** ✅ The photo's own date (EXIF) is read and used when the receipt has no printed date, for
  the draft's date (#118).
- **RCP-6** 🟡 Where the photo was taken: the camera screen asks for a position of its own, so a
  photo taken here is located. ❌ A picked or shared image's own EXIF GPS is not read.
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
- **DRF-5** 🟡 Payee/Payer as a labelled row. ✅ The New payee flag, the alias caption, and alias
  learning (correcting a misread payee teaches an alias, with Undo). The heading under the amount is
  what still isn't marked as tappable.
- **DRF-6** ✅ From / To.
- **DRF-7** 🟡 Category, Budget (expenses only), Date, Description.
- **DRF-8** ✅ Shared with several people, separated by commas (#121).
- **DRF-9** ✅ Date: the printed date, else when the photo was taken, else when it was captured (#118).
- **DRF-10** ✅ "Check" marks on what the reader wasn't sure about (#120), with a note saying so.
- **DRF-11** 🟡 Receipt: ✅ photo, full screen, item count, **Remove photo** in the viewer; ❌ crop (#70).
- **DRF-12** ✅ "Read by Gemini (gemini-3.1-flash-lite)" under the receipt card, and in Diagnostics.
- **DRF-13** ✅ A faint "📍 near 52.22971, 21.0123" line when the entry has a position. The
  coordinates as they are: a place name would need a geocoder, and Firefly III's own map is where
  this is worth looking at.
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

- **TXN-1** ✅ Header: the type, and "synced 5 min ago" / "changes queued" / "not sent". ⋯ →
  Duplicate, Create a rule (a Firefly III rule from this transaction), Delete.
- **TXN-2** ✅ Amount (tap for the keypad) and title (tap to edit).
- **TXN-3** ✅ Payee/Payer row, tappable, on a single transaction (#115). A split shows each split's
  payee on its own page.
- **TXN-4** ❌ Converted amount, shown and editable. Not shown yet, although the cache keeps it.
- **TXN-5** ✅ Type, From / To, Category, Budget, Date, and Note, tags and shared with (in the Note
  sheet). Shared with takes several names, separated by commas (#121).
- **TXN-6** ✅ Receipts: thumbnails, full screen, uploading / failed state, Attach another, and
  **Remove photo** in the viewer — a confirmed, queued `delete_attachment`.
- **TXN-7** ❌ Read by (#68, extended) and Location, neither shown here — both are on the draft,
  and the pin is on Firefly III's map.
- **TXN-8** ✅ **Split** and **Save**. Split sits at the bottom until you change something; then Save
  appears with Undo. Save stays off while the splits don't add up.
- **TXN-9** ✅ Conflict view: what changed in Firefly III next to your change, with Keep mine /
  Use server (for a delete: Delete anyway / Keep it).
- **TXN-10** ❓ The Type row changes a single transaction, rewiring its accounts and payee
  (`src/transactions/changeType.ts`); a split's kind is fixed. Keep that, or go back to: duplicate it
  as the other type and delete the original?
- **TXN-11** ❓ An "Open in Firefly III" link to the web page.

## 8. Planned

Subscriptions and recurring transactions, handled as one thing. Tab 3.

- **PLN-1** ✅ **Coming up** / **All plans**, as a switch at the top. Coming up lists the next
  occurrences in Today, This week and Later in <month>, each with its date, amount, route and
  schedule, and "Skipped" when it is. All plans is one card of every planned payment, with a pending
  dot and the next date. **＋** adds one.
- **PLN-2** ✅ Tapping a Coming up row opens the **occurrence sheet**: amount, date, from, to,
  category and status, with **Skip this one** (or Unskip), **Book it now**, and **Edit planned
  payment** (which opens the planned payment's page).
- **PLN-3** ✅ **Planned payment page** (push): an Expense / Income / Transfer switch; name, from,
  to, amount, currency, category; **Repeats** and time, which open the schedule sheet; the next
  occurrences; **Remind me**; note and tags. A Save bar appears once something changes. ••• → **Book
  it now** (recurring ones) and Delete.
- **PLN-4** ✅ **Book it now** on a planned transaction Firefly III holds: it fires the occurrence
  through FF3's own trigger endpoint, queued, and the booked transaction arrives in the Inbox as a
  recurring review on the next sync.
- **PLN-5** ✅ **New planned payment** (modal, three steps). **What**: type, name, amount, currency,
  from, to, category. **When**: Once, Weekly, Monthly or More… (the full schedule sheet, with the
  next dates previewed), and the first date and time. **Check**: a summary, Remind me, note, tags and
  what it will be saved as. **Create** is the last button. After the first planned payment, a
  **reminder prompt** asks whether to turn reminders on, before the phone asks for permission.
- **PLN-6** ❓ Budget on a planned payment; a converted amount; what it booked recently.

## 9. Cash count

Count the cash envelopes and book the differences. Activity ⋯ → Cash count. A modal.

- **CNT-1** ✅ Every cash-envelope account is one row in one card: name and pending dot, the expected
  balance, a box for the counted amount (typed), a 🧮 button when the currency has denominations, and
  the result: ✓ when it matches, the adjustment when it differs, or "Skip".
- **CNT-2** ✅ Refuses while balances may be out of date (changes queued, or balances not re-read
  since): a banner says so, the rows are greyed out, and the footer reads **Sync before counting**,
  with **Sync now** in the banner.
- **CNT-3** ✅ **Review adjustments** sheet: one line per envelope that differs, a "Booked as" card
  (shortfall payee, surplus payee, category), and **Confirm N**. Each row opens the Reconcile
  settings sheet, where you pick the payees and an optional category.
- **CNT-4** ✅ **Count denominations** sheet: a + and − for each note and coin, a running total, and
  **Use <amount>** to type it into the row.
- **CNT-5** ✅ With no envelopes yet, the screen lists your asset accounts as switches: switching one
  on makes it a cash envelope. With no asset accounts, it offers to go to Accounts.

## 10. Accounts

Settings → Accounts, Settings → Liabilities, or long-press a balance card in Activity.

- **ACC-1** ✅ List: one card, with search, show or hide inactive, reorder, **＋ New account** (or
  New liability), and a pending dot. Each row's line says its kind, or "Inactive".
- **ACC-2** ✅ Account page (push): its balance is not repeated here. Details: name, note, kind,
  currency, and the monthly payment date (credit cards). Where it shows up: switches that say what
  they do, **In pickers and lists**, **In the cash count**, and **In net worth**. Starting point:
  the opening balance and its date, and the virtual balance, each a row that opens a sheet. A cash
  envelope has a **Count cash** button. A Save bar appears once something changes.
- **ACC-3** ❓ **Show transactions**, opening Activity filtered to this account.
- **ACC-4** ✅ **New account** (modal, two steps). Step 1: **Money I have** or **Money I owe**, then
  name, type (or liability type), currency, the paid-off day for a credit card, and In net worth.
  Step 2: **Balances**: the opening balance and its as-of date. For a liability it is **What you
  owe today**: the direction, the amount, the interest rate and period, and the credit limit.
- **ACC-5** ✅ **Liabilities** (Settings → Liabilities): the same list card, with + to create one,
  and open, edit or archive.

## 11. Settings

Tab 5. The first row is **Firefly III**, which shows whether you're connected. The rest is grouped
in cards: **When you add money**, **Reading receipts**, **Accounts and money**, **Automation in
Firefly III**, **Privacy and reminders**, and **App**.

- **SET-1** ✅ **Firefly III** page (Settings → Firefly III, "Your Firefly III"): sign-in, its
  addresses (the one that answers is used), the access token, **Reverse proxy** (extra headers sent
  with every request, with a Cloudflare preset), and **Try the demo** / **Leave the demo**. Sign out
  is refused while changes are queued.
- **SET-2** ✅ **Receipt reading** page: your local model (name, addresses), and the Google Gemini
  key, with a line saying which reader is in use.
- **SET-3** ✅ **When you add money**: Pay from (default account), Cash comes from, Currency, and
  **Record where it was made**, on unless turned off. Turning it off keeps the permission and stops
  the app using it.
- **SET-4** ✅ **Accounts and money**: Asset accounts (with the envelope count), Liabilities, and
  Aliases (search, add, remove, export and import).
- **SET-5** ✅ **Automation in Firefly III**: **Rules** (rule groups and their rules; switch a rule
  or a group, run a rule now, New rule) and **Planned in Firefly III** (read-only subscriptions,
  rules and recurring transactions, as stored).
- **SET-6** ✅ **Privacy and reminders**: **Require unlock** (fingerprint, face or screen lock when
  the app opens and after a few minutes in the background), and **Reminders**: a preview of a
  reminder, the on/off switch, when (on the day, the day before, a few days before, a week before, at
  what time, and whether to nudge again on the day), which payments (all, only bigger ones, only money
  going out), one message for the whole day, and a warning when an account may run short.
- **SET-7** ✅ **App**: Language, and **About and help** (version, last sync, and Diagnostics with
  share and clear).
- **SET-8** ❓ Theme (system / light / dark); which Gemini model to use (#68 mentions its default).

## 12. Budget

Envelope budgeting on top of Firefly III. Tab 4.

- **BDG-1** ✅ **Ready to assign**: one big number at the top (what your accounts hold minus what is
  already set aside), a breakdown line, and **Auto-fill** when there is money to assign: it tells you
  the total and how many envelopes before it spreads the money. A footnote says why Firefly III's
  "left to budget" is a different number.
- **BDG-2** ✅ **Envelopes**: one card with a row per Firefly III budget, its remaining amount and a
  bar. Overspent envelopes say so, with a row to cover the shortfall from another envelope. Tap a row
  for its page.
- **BDG-3** ✅ **Sinking funds**: one card per piggy bank, with what is saved and its target. Tap to
  set the amount, which funds the piggy bank in Firefly III.
- **BDG-4** ✅ **Due this month**: the subscriptions and bills due, one card.
- **BDG-5** ✅ **New envelope** is a sheet: a name field, suggestions from your categories, and
  **Create envelope**.
- **BDG-6** ✅ **Envelope page** (push): Available; **Set the amount**; **Move money here** (from an
  envelope that still has some); This month (assigned, spent, last month); the envelope's name, which
  is changed with a Save bar; ••• → Delete, after a confirm. Offline changes queue like the rest.

## Your calls (❓), in one list

INB-6 (📎 on cards) · INB-13 (possible duplicate) · INB-14 (order) · CAP-14 (your cut-off note) ·
RCP-8 (two-photo receipts) · ACT-5 (more on a row) · ACT-8 (date and category filters) · TXN-10
(keep the Type row, or duplicate and delete instead) · TXN-11 (Open in Firefly III) · PLN-6 (budget,
converted amount, what it booked) · ACC-3 (Show transactions) · SET-8 (theme, Gemini model) · §1.2
notes 7 (category on reviews) and 8 (tags on Draft).

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
| Capture: location                                                                  | CAP-10                  |
| "Should have figured"                                                              | CAP-14                  |
| Capture crammed on small windows                                                   | CAP-13 (#116)           |
| No way to edit an existing withdrawal's payee                                      | TXN-3, DRF-5 (#115)     |

</details>
