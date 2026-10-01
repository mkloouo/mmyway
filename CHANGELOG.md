# Changelog

## [Unreleased]

### Cash count

- Cash count adjustments no longer block saving with "Configure payees first" when shortfall or surplus payees haven't been picked by hand. The count automatically defaults to "Cash shortfall" and "Cash surplus" (creating them in Firefly III if needed), and the review sheet shows the chosen payees with direct access to change them.

### Capture

- A transfer between accounts with different currencies typed in the source account's currency preserves the destination foreign amount without swapping currencies.
- Saving an entry with the date left as "Today" after midnight records today's current date instead of yesterday's.

### Inbox

- On a receipt review, an unsure amount highlights the main amount at the top in amber alongside the warning banner.

### Activity

- Removing splits from an uncommitted split transaction down to one returns to the regular single-transaction edit view instead of locking the split pager in place.

## [1.5.0] - 2026-09-30

### Capture

- Capture fits a pop-up or split-screen window, landscape and large text. The fields under the
  amount scroll when there isn't room, and the keypad and **Save to inbox** always stay on screen.
- The 🔍 at the start of each chip row stays put while you scroll the chips beside it.
- Chips are easier to hit: they react to a touch a little above and below where they're drawn.
- **Shared with** takes several people, separated by commas. Each one becomes its own tag in
  Firefly III.

### Receipts

- A receipt with no printed date is dated when the photo was taken (read from the photo), or else
  when you added it. Before, it got the time it was read, which could be hours later. A printed
  date without a time takes the photo's time if the photo was taken that day.

### Inbox

- A draft's payee (or payer) is now the first row of its details, labelled and tappable like the
  other rows. The title is the heading under the amount.
- On a receipt draft, a banner names what the reader wasn't sure about (amount, payee, date), and
  those rows stay amber until you set them. Its card says **Check the reading**.
- A draft card from another day shows its date ("yesterday at 14:05", "3 Sep at 14:05"), not just
  the time.
- A receipt that no reader could reach says it's **waiting for a receipt reader** instead of
  "Reading receipt…", and has **Retry now**.

### Activity

- An expense or income now has a **Payee** (or **Payer**) row, so you can see and change who it
  was paid to or received from. Before, only a split transaction showed it.

### Fixed

- A recurring income or transfer waiting for review is shown as income or a transfer with your own
  account. Before, it was drawn as spending. Its **Edit** now changes the account the money went
  to (both accounts for a transfer); before, it replaced the payer with one of your accounts.
- Editing **Shared with** on a transaction shared with two people no longer drops one of them.

## [1.4.6] - 2026-09-30

### Capture

- A **title** field sits between the amount and the payee, so a transaction is named without
  opening anything. The **Details** chip is gone; the keypad's Note key is now **More**, and shows a
  dot when its description, who it is shared with or its photo is set.
- Once a date is picked, the keypad's date key uses a much smaller font so the whole date fits.
- Loans, debts and mortgages from Firefly III can be picked as accounts.

### Inbox

- A draft always shows its **title** under the payee (empty until entered, tap to type it), as
  Capture does, even when it is the same as the payee. Before, it was hidden in that case and
  only entered from the ⋯ menu.

### Accounts

- An account's page has a **Description** under its name, saved to the account's notes in Firefly
  III. The cash-envelope checkbox still works and never shows up in the description.

### Changed

- What Firefly III calls a transaction's description is now called **Title** everywhere in the app,
  and its notes are called **Description**, in Capture, drafts, transactions, Planned, Activity's
  search and the change lists. Nothing changes in Firefly III.
- On a split transaction, the name of the whole group is now **Group title**, so it is no longer
  confused with each split's own **Title**.

### Fixed

- Changing the amount on a receipt draft no longer goes through the database for every digit: it
  shows at once, a fast second digit no longer replaces the first, and a receipt with many items no
  longer redraws every item's page for each digit.
- Typing a title, description or "shared with" on a draft or transaction no longer saves every
  letter: the text is kept as you type and saved once when you leave the field or close the sheet,
  so typing stays smooth on a receipt with many items.
- A receipt with many items only builds the item in view and its neighbours, and the category,
  budget, account and description sheets are built when first opened, so every edit on it is
  lighter.
- The Inbox no longer redraws itself behind an open draft or Capture; it catches up when you come
  back.

## [1.4.5] - 2026-09-30

### Fixed

- If **Undo** on a just-confirmed entry fails, you now get an error message; before, the snackbar
  closed as if it had worked and the entry was still sent.
- Activity no longer shows a just-sent transaction twice for a moment (and logs a duplicate-key
  error) when it moves from Queued to synced.
- Opening a transaction or a draft no longer flashes "PLN" instead of "zł" for a moment, and
  the accounts and budget show a spinner while they load instead of "—".
- After signing out or signing in to another Firefly III, drafts, aliases and the default, cash and
  cash-count accounts ask for their accounts again instead of pointing at the old ones, and a sync
  that was running at that moment can no longer bring the old instance's data back.

## [1.4.4] - 2026-09-30

### Planned

- A planned transaction's note is its subscription's note in Firefly III, line breaks included; the
  app keeps the time on the recurring transaction on its own. Saving one without a note needs a
  Firefly III whose API accepts clearing a subscription's notes: stock 6.7.6 refuses it with "The
  notes must be at least 1 characters".

### Fixed

- Setting a transaction's category or budget to **None** now clears it in Firefly III; before,
  the old one stayed. The same goes for a split without a category or budget.
- Saving a planned transaction on a flaky connection no longer creates it twice or gets stuck.
- Cancelling a new transaction whose send failed now checks Firefly III first, so it can't end up
  booked twice. If it already arrived it is kept as sent; if Firefly III can't be reached, it stays
  queued.
- Syncing no longer stops for good after a request that never gets an answer (for example when
  the phone switches networks mid-sync).
- A planned transaction's time no longer turns into "Any time" after an edit, with
  "mmyway-time: 09:00" glued onto the end of its note. Times already caught this way are read back
  correctly.
- A change you make is sent within seconds again while another change waits to be retried — it
  could wait up to an hour.

## [1.4.3] - 2026-09-29

### Capture

- A transfer is named after its accounts ("PKO · Personal → Cash · Base") instead of "transfer",
  unless you give it a description.

### Inbox

- A change waiting in the Queued section can be cancelled with its **Cancel** button. A new
  transaction goes back to the Inbox to edit and confirm again; any other change is dropped
  without being sent.
- **Cancel sending** on a queued transaction also works after a failed attempt to send it, and
  says that the transaction goes back to the Inbox to edit.

### Activity

- A transaction's title can be edited: tap it under the amount. On a draft, a transfer's title
  (or any title that says more than the payee) shows under the amount and can be tapped too.

### Planned

- **Save** on a planned transaction stays off until you change something.

### Fixed

- Changes no longer sit in the queue after a moment without network, such as a failed address
  lookup right after switching networks. The app tries again by itself, after 5 seconds, then
  less and less often, up to every 5 minutes, instead of waiting for you to reopen it or pull to
  refresh.
- The Inbox's status no longer keeps saying **Offline** or **Sync error** after changes were sent
  since.

## [1.4.1] - 2026-09-29

### Receipts

- While a receipt is being read, its Inbox card says which reader is reading it (your local model
  or Gemini), and switches when one gives up and the next takes over.
- A receipt read without a currency can now be given one: the review screen shows a **Pick a
  currency** button, and its ⋯ menu has a Currency row to change it at any time.

### Fixed

- **Save & ✓** and **Save to inbox** on Capture did nothing, and closing Capture then asked to
  discard the entry. Both save again.
- The amount keypads keep up with fast typing: a quick second digit no longer replaces the first,
  and typing or deleting no longer lags behind your finger.
- Saving a planned transaction without changing anything no longer sends it to Firefly III, and a
  planned transaction with no notes no longer fails with "notes must be at least 1 character".
- Receipt errors name the reader as "Gemini" and "Local model" rather than "gemini" and "local".

## [1.4.0] - 2026-09-29

### Fixed

- A change Firefly III refuses no longer holds back every change queued after it: only the
  changes to the same transaction, account, planned transaction or Inbox entry wait for it, and the
  rest are sent. When Firefly III can't be reached at all, everything still waits.
- Count cash now shows the expected balance, the drift and the review rows in the phone's own
  number format, with the currency's symbol — the same as everywhere else in the app.
- Activity, the Inbox and every other list no longer redraw themselves each time a sync touches
  rows they don't show, so scrolling stays smooth while a sync runs.
- Opening a payee or a target picker no longer costs a database read taken while the sheet was
  still closed.
- A screen reader now names the Inbox's 📷 button, Capture's currency button and Capture's close
  button, and an alias's remove button says it removes an alias rather than an address.
- Holding an account row in Settings → Accounts no longer does the same as tapping it.
- A planned transaction's card gives the payee a line of its own, so a long name is no longer cut
  off by the schedule sharing the line with it.
- The Connection section in Settings, and a planned transaction's amount, no longer shift a moment
  after the screen opens.
- In Ukrainian, the planned editor's **Repeats** hint said "discount for a one-time payment", and
  "every N periods" lost its number for 21, 31 and so on. Both now read correctly.
- Typing or deleting in a draft's note, shared-with or description no longer jumps the cursor
  around, drops letters or deletes the wrong ones.

## [1.3.0] - 2026-09-28

- The app is now called **Money My Way**.

### Splits

- **Split** next to Save (and next to Confirm on a draft) adds a split: type its amount and it
  comes out of split 1. **Choose which splits give it** shows sliders instead, one per split,
  always adding up to the new amount.
- A split transaction shows its total on top and one page per split: swipe sideways to move
  between them. Each split has its own amount, description, payee, category, budget, note and
  shared-with; the date and your own account are shared by all.
- Tap the total to change it, or change one split's amount: split 1 takes up the difference
  (split 2, when you changed split 1). When it can't, sliders ask where the difference goes, and
  Save waits until it's placed.
- A split can be removed; split 1 takes its amount. Removing the first split keeps the link to
  the entry that created the transaction, and a removal that stops part-way finishes on the next
  sync instead of turning into a conflict.

### Activity

- A split transaction lists its splits under its row: category (or description) and amount for
  the first three, and how many more there are.
- Account balances roll to their new value after a sync instead of jumping.
- Switching between accounts, or between All, Spending, Income and Moves, shows the new list
  faster and without stutter.
- Holding an account card no longer thickens its border; the card still pops and the phone ticks
  when its page opens.
- Menu actions (Duplicate, Delete, Count cash, Sign out, Diagnostics, Open in Activity) show an
  icon for what they do instead of a dash.
- **Duplicate** on a transaction makes an Inbox draft with exactly the same data — date, splits,
  tags and all — and opens it for review.

### Inbox

- A recurring transaction planned in another currency than its account's (7.99 USD paid from a
  PLN account) shows its planned amount on the review card. Approving asks what was actually
  charged ("7.99 $ was charged as ..."), and saves both amounts to Firefly III.
- Editing a recurring review is tidier: the amount reads 7.99 instead of 7.990000000000, the
  account opens a searchable picker instead of a wall of chips, and the currency follows the
  account instead of being typed.
- The Approve button on a recurring review card no longer breaks its label across two lines.
- A change that failed to reach Firefly III says what it was ("Saving a planned transaction
  failed") and what it was for (the transaction, account or planned transaction, by name), and
  its error can be tapped open to read in full. Tap the card to open what it was changing.
- A new **Queued** section lists every change still waiting to reach Firefly III — new
  transactions, edits, deletes, receipt uploads, recurring approvals, account changes and planned
  transactions — so the count on the sync pill matches what you see. Each card says what the
  change edits ("Changes: Planned on · Amount"); editing a planned transaction again before the
  first edit is sent updates that edit instead of queueing a second one. Tap one to open it.

### Planned

- A new **Planned** tab. The simple view lists each planned payment — a subscription, rule and
  recurring transaction sharing one name — once, with its category, and edits the three together:
  name, from and to, exact amount and currency
  (Spotify's 7.99 USD from a PLN account), note, whether and how often it repeats, the date it's
  planned on, category and tags. Changing when it happens (the date, or whether and how often it
  repeats) replaces its recurring transaction in Firefly III with a new one, because Firefly III
  can't move most schedules in place. Add one with **+**; delete it from its page. Picking a payee
  fills in its usual category and paying account, unless you've already chosen them; a payee
  Firefly III doesn't have yet is added there as an expense account when it's saved.
- A planned transaction can have a time. Firefly III only plans days, so the time is kept in its
  recurring transaction's notes (as an `mmyway-time` line); approving the booked transaction in
  the Inbox moves it to that time.
- The detailed view lists Firefly III's subscriptions, rules and recurring transactions
  separately, exactly as they are there; tap one to see everything about it.

### Fixed

- A transaction Firefly III books from a recurring transaction now shows up in the Inbox for
  review, including one triggered early from Firefly III's Recurring page. Before, none ever
  arrived.
- The time of an entry can be changed: picking a date on a transaction, a draft or in Capture
  now asks for the time next.
- A queued entry no longer disappears from Activity for a moment when it reaches Firefly III: it
  stays in place and turns into the synced transaction.
- In Activity, an entry still waiting to be sent shows only under its own account, type and
  search, not under every one.
- The Inbox's **Undo** snackbar now goes away after 5 seconds as it should. It used to stay up
  while the Inbox refreshed, so a late Undo on a delete did nothing and one on a confirm said
  "Already sent".
- A transaction no longer opens to the error screen when one of the changes queued for it can't
  be read, and such a change no longer breaks the Activity list.
- Failures that used to pass silently now show a message and go to the Diagnostics log: saving a
  draft's fields, deleting a draft or transaction, signing out, removing an alias, and choosing
  defaults in Settings, the cash count's settings or the Planned view.
- Settings → Aliases search finds "Żabka" when you type "zabka", like every other search.
- The payee list on a draft, a transaction or a planned transaction no longer shows another
  type's payees after switching the type quickly.
- Capture no longer asks to discard an entry whose amount is only "0,".
- **Save** on a transaction you didn't change just closes, instead of sending an edit that
  changes nothing (picking the same category again, or closing the keypad, counted as a change).
- An edit that leaves a note empty no longer fails in Firefly III ("at least 1 character"). One
  that already failed this way goes through with **Retry now** in the Inbox.
- The keyboard no longer covers the lower text fields on an account's page.
- A transaction's receipt photos show what Firefly III holds now. After the photo a transaction
  was captured from was deleted in Firefly III, the next photo attached to it didn't show and the
  deleted one stayed on screen. Photos stored in Firefly III now load (they showed as grey boxes,
  and black when opened); one that can't be loaded says so, and Diagnostics has the reason.

## [1.2.0] - 2026-09-28

### Accounts

- Each account now has its own page: tap or long-press it in Settings → Accounts, or long-press
  its balance card on Activity. Change its name, currency, role (default, shared, savings, credit
  card with its monthly payment date, or cash wallet), whether it's active, a cash envelope or in
  your net worth, its opening balance and date, and its virtual balance. Saved together with
  **Save**, and sent to Firefly III like any other change, offline too.
- An account with changes still waiting to reach Firefly III shows a yellow dot on its card: on
  Activity, in Settings → Accounts, on Count cash and on its own page.
- Settings → Accounts has an eye button that hides or shows inactive accounts. With them hidden,
  Reorder moves an account past the one you see next to it, and hidden accounts keep their places.
- Holding an account card draws a border that grows until its page opens; when it opens the
  phone ticks and the card pops, like every other confirmation.

### Activity

- Search ignores case and accents: "żabka" finds "Żabka", in Polish and Cyrillic too.
- Filtering by an account keeps working after the account is renamed, or when two accounts share
  a name.
- A split transaction shows its total under its title, instead of only its first part.

### Receipts

- Photos are scaled down to 1600 px before they're read and uploaded: faster with a local model,
  cheaper with Gemini, and smaller attachments in Firefly III.
- Settings → Gemini key says when receipt photos go to Google.

### Sync and offline

- Going back online sends what was queued at once, without reopening the app.
- mmyway also syncs in the background, about every 15 minutes when Android allows it.
- A change Firefly III keeps refusing is retried after a pause that grows to an hour, instead of
  on every sync. **Retry now** in the Inbox still sends it at once.

### Cash count

- Denominations for GBP, CHF, CZK, HUF, SEK, NOK, DKK, RON, CAD and JPY.

### Look and feel

- Smoother exits: confirmed, deleted and swiped-away Inbox cards and deleted Activity rows fold
  away, and the rest slide up instead of jumping. In Capture, the saved amount floats up and fades
  while the cleared field fades in.
- Everything that vibrates also moves, for phones without vibration: keypad keys shrink under
  your finger, a card or row you select pops, a confirm or delete pops its Undo bar in, the sync
  pill pops when the queue empties, and whatever blocks a Save & ✓, a confirm or a swipe shakes.
- Amounts follow your phone's number format (for example "1,234.50" or "1 234,50").
- Every text field shares one look.

### Privacy

- The app's database is no longer included in Android's Google Drive backups. A new phone signs in
  and syncs from Firefly III.
- A shared diagnostics log hides amounts, payees, accounts and notes.

### Fixed

- Currency pickers offer only the currencies enabled in your Firefly III (your primary currency
  first), not every currency it knows, BTC included.
- With no default currency set in Settings, a new entry uses your Firefly III primary currency
  instead of none.
- Reordering accounts now reaches Firefly III; the new order used to stay on the phone.
- Payee suggestions now also fill in the usual budget.
- The diagnostics log keeps the lines from before the app was last closed.
- If the app can't update its database after an update, it now says so and offers the diagnostics
  log, instead of opening with screens that fail in odd ways.
- Tapping the Activity tab again scrolls back to the top.

### Settings

- **Language**: mmyway now follows your phone's language, or you can pick one in Settings →
  Language (System, English or Українська). Dates and times follow the language you pick.
  Text that isn't translated yet shows in English.

## [1.1.0] - 2026-09-28

### Look

- Change the app name to what I meant to call this app.
- New app icon: a white stepped arrow on indigo. On Android 13+ it follows your themed-icon colours.
- The launch screen now shows the same arrow in a circle, on a light or dark background to match
  your phone's theme, instead of the placeholder icon.

## [1.0.0] - 2026-09-28

The first release. mmyway is an Android companion for your self-hosted
[Firefly III](https://www.firefly-iii.org/): quick capture of spending and income, receipts read by
a model, and an Inbox where every entry waits for your confirmation before it reaches Firefly III.
It works offline and sends everything once your server answers. It replaces a Telegram capture bot.

### Capture

- Amount-first: a big keypad, then the payee. Expense, Income or Transfer.
- Payee chips come from your Firefly III history, most recently used first, and bring their usual
  category and account with them. Search finds any payee, including through your aliases.
- Pick a currency; when it differs from the account's, a conversion field appears so Firefly III
  books the right amount in the account's currency.
- Today, Yesterday or any date; description, notes, a photo, and "shared with" (tagged
  `mmyway-shared-<person>`).
- **Save & ✓** confirms at once, with five seconds to Undo; **Save to inbox** keeps it as a draft.
  The screen stays open for the next entry.

### Receipts

- Take a photo, pick one from the gallery, or share an image from any app to mmyway.
- Read by your own OpenAI-compatible model (LM Studio, for example) first, then Google Gemini
  if it's set up. Categories and currencies come from your Firefly III, never a fixed list.
- Fields the reader wasn't sure of are marked "check this"; a picture that isn't a receipt says
  so. Offline, the photo is kept and read on a later sync. The same photo twice is caught.
- The photo is attached to the transaction in Firefly III once it's created, and stays on the
  phone for 30 days after that.
- Payee aliases: correct a receipt's printed shop name once ("ZABKA POLSKA SP Z O O" → Żabka) and
  every later receipt from that shop books to the right payee. Manage them in Settings → Aliases,
  with export and import.

### Inbox

- An approval queue: **Needs attention**, **To confirm**, **To review**. Empty sections hide.
- Swipe right to confirm, left to delete (with Undo). Long-press to select several; Confirm all.
- Recurring transactions Firefly III created since your last sync come in to review: approve,
  edit or delete them.
- Anything Firefly III rejects shows its reason, with Retry or Discard. An edit to a transaction
  that changed in Firefly III meanwhile opens a side-by-side view: keep yours or use theirs.

### Activity

- A balance card for each asset account (tap one to filter), then All, Spending, Income and Moves.
- Transactions grouped by day with daily totals; scrolling past what's on the phone loads older
  history from Firefly III. Search falls back to Firefly III's own search the same way.
- Entries and edits not yet sent are marked Queued.
- Open a transaction to edit it, delete it, or attach and view receipt photos. Long-press to
  delete several.

### Cash count

- Mark asset accounts as cash envelopes, then count them all in one pass, by amount or with a
  denomination pad (PLN, EUR, USD, UAH). One confirm books one adjustment per envelope that's off.
- The count waits until every queued change has reached Firefly III and balances are re-read,
  so offline spending is never booked twice as drift.

### Sync and offline

- Everything works offline. Changes go out in order as soon as Firefly III answers, each exactly
  once, even when a connection drops mid-send.
- Edits and deletes check whether the transaction changed in Firefly III first, and ask instead
  of overwriting.
- Several addresses per server (home network, tailnet, public name): the first one that answers
  is used. Plain `http://` addresses work.
- Syncs on launch, right after a change, on returning to the app after 30 minutes, and on
  pull-to-refresh. Transactions deleted in Firefly III disappear from the phone too.

### Settings

- Sign in with your Firefly III address and a personal access token. Sign-out waits until
  nothing is queued, then clears that server's data from the phone.
- Default account, currency and the account cash payments use; receipt readers.
- Accounts: hide inactive ones, mark cash envelopes, and reorder (saved to Firefly III, used by
  every account picker).
- Diagnostics: a log of recent warnings and errors to read, share or clear.
- Light and dark theme follow the system.

### Install

- Needs Firefly III with API version 6.3.2 or later, and Android.
- Each release has one APK per processor type and a universal one. Most phones want
  `arm64-v8a`; if unsure, use `universal`. Check downloads against `SHA256SUMS`.
- Your data stays on the phone and your Firefly III. Receipt photos go to Google only when Gemini
  reads them; see PRIVACY.md in the repository.

### Known limitations

- Split transactions show only their first split in Activity and its totals.
- The budget isn't suggested from payee history yet.
- Activity search matches Polish and Cyrillic letters only in the same case ("żabka" doesn't
  find "Żabka").
- Nothing syncs by itself when the network comes back; the next launch, change or pull does.
- Android only, English only, and amounts are formatted Polish style (1 234,56).
