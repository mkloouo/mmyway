# Changelog

## [Unreleased]

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

