# Commercialization, Legal Considerations & Product Roadmap

Reviewed 2026-10-11 against the code at v1.10.0 and against Firefly III v6.7.7's source. Paths that
have shipped, or that a newer plan now owns, are marked and moved out of §2 rather than left to rot
there. The two feature plans this document now defers to:

- `ynab-bucket-budgeting-plan.md` — envelopes (budgets + budget limits), sinking funds (piggy banks),
  Ready to Assign.
- `planned-transactions-plan.md` — the schedule model, the occurrence list, per-occurrence skip, the
  6.7.0 floor.

---

## 1. Legal, Licensing & Author Stance

### 1.1 Firefly III Author's Stance (James Cole / JC5)

* **No Opposition to Third-Party Frontends or Monetization:** James Cole has never taken issue with developers building frontends or charging for them. In fact, Firefly III maintains an official documentation page explicitly listing third-party mobile clients (such as Waterfly III, Abacus, Photuris III, and FireFlow on iOS).
* **Precedents:** Ecosystem apps like *FireFlow for Firefly III* (iOS) offer in-app purchases. Furthermore, the official Firefly III Data Importer integrates with commercial data providers (like SimpleFIN and Lunch Flow) that charge recurring subscription fees; the official documentation acknowledges that these tools charge money.
* **James Cole's Operating Model:** James Cole develops Firefly III as a hobby/passion project and works a separate full-time job. He has repeatedly noted in GitHub discussions that he does not want to build mobile apps or a cloud SaaS due to maintenance burden and lifestyle preferences. He encourages the community to build mobile apps on top of the public REST API.

### 1.2 Legal & Licensing Reality (AGPLv3)

* **Firefly III Backend License:** Firefly III is licensed under GNU Affero General Public License v3 (AGPLv3).
* **API Interaction Over Network:** Under copyright law and Free Software Foundation guidance, independent software that communicates with an AGPL server strictly across network protocols (HTTP REST API) is not a derivative work. The copyleft provisions of AGPLv3 do not "infect" or extend to client applications running on user devices.
* **mmyway Codebase Ownership:** The code for `mmyway` was written independently and licensed under the PolyForm Noncommercial License 1.0.0 (`LICENSE`, © 2026 Mykola Odnosumov). All dependencies in `package.json` are standard permissive licenses (MIT, Apache-2.0, BSD). Therefore, the author has complete legal freedom to:
  1. Remove the code from public GitHub or make the repository private.
  2. Relicense the app under a closed-source proprietary commercial license / EULA.
  3. Distribute the application on the Google Play Store / App Store for a fixed upfront price.
* **This story holds only while nothing of ours sits between the app and the user's Firefly III.** See §4 — the no-backend decision is a licensing and liability decision as much as a technical one.

### 1.3 Key Brand & Community Guidelines

1. **Name and Logo Policy:** Firefly III has an explicit name and logo policy. The app must not be named "Firefly III" (or imply it is the official app). A distinct name must be used (e.g., "mmyway: for Firefly III"). The official logo (the flame piggy) must not be used as the app icon or marketing brand. A clear disclaimer must be included: *"mmyway is an independent client and is not affiliated with, endorsed by, or sponsored by Firefly III or James Cole."*
2. **Support Burden:** Avoid directing users to Firefly III's GitHub issues for app bugs. Maintain independent support and in-app diagnostics.
3. **Minimum server version is now a product promise.** `planned-transactions-plan.md` Phase 1 raises `MIN_API_VERSION` to 6.7.0. Store copy and the sign-in error have to say it; a self-hoster on 6.5 who buys the app and cannot sign in is a refund and a one-star review.

---

## 2. Critical Paths Still Missing for a Commercial Standalone Client

Each item below was checked against the code. "Current State" is what v1.10.0 actually does.

### 2.1 Account Creation & Full Management — **still open, unchanged**

* **Current State:** `app/accounts/[id].tsx` edits an existing asset account (opening balance and
  date, virtual balance, account role, net-worth inclusion, credit-card type and payment date,
  active, the cash-envelope marker) and Settings → Accounts reorders them. There is **no**
  `POST /v1/accounts` anywhere in `src/accounts/` — accounts are created only implicitly, as payees,
  by `FF3Service.accounts.resolve` (`src/api/ff3/service.ts`).
* **Required Flow:**
  - `POST /v1/accounts`: a creation flow for Asset, Liability (Credit Card, Loan, Debt), Cash, and
    Revenue/Expense accounts.
  - Liability support: interest rate, payment frequency, credit limit.
  - Archiving / deactivating accounts (the `active` flag is already editable; the list has no
    archived section).
* **Note:** this is the prerequisite for the liability work that `ynab-bucket-budgeting-plan.md` §5
  explicitly defers. Do accounts first or the budgeting feature inherits the gap.

### 2.2 Rules & Automation Management — **still open, unchanged**

* **Current State:** rules are written only as part of the subscription trio in `src/planned/`
  (`ruleBody` owns five action types and preserves any others); `app/planned/object/[key].tsx` shows
  them read-only. There is no rule-group surface and no way to run a rule.
* **Required Flow:**
  - View and toggle Rule Groups (`/v1/rule-groups`) and Rules (`/v1/rules`).
  - "Create Rule from Transaction" quick action on the transaction screen.
  - Trigger rules on existing transactions.
* **Correction:** the useful action set is what `config/firefly.php` L432–465 actually registers —
  22 actions, including `set_budget`, `set_notes`, `clear_notes`, `convert_*`, `switch_accounts`,
  `set_amount` and `update_piggy`. There is no `remove_from_piggy_bank`; `update_piggy` infers its
  direction from whether the piggy's account is the transaction's source or destination.

### 2.3 ~~Piggy Banks (Savings Goals)~~ — **owned by `ynab-bucket-budgeting-plan.md` (Phase 1 read, Phase 4 write)**

Piggy banks are no longer a standalone roadmap item: they are the *sinking fund* archetype of the
bucket plan, which reads them in Phase 1 and writes them in Phase 4.

Two corrections to what this document used to claim, both from the v6.7.7 source:

* **`POST /v1/piggy-banks/{id}/events` does not exist.** Only `GET {piggyBank}/events`
  (`routes/api.php` L511). Saved amounts change through `PUT /v1/piggy-banks/{id}` with the
  `accounts[]` array carrying an absolute `current_amount` per account.
* **A piggy bank's `target_amount` of 0 means "no target"** and switches off both the
  over-target validator and the repository clamp. An open-ended savings pot is expressible; a
  *negative* balance is not (`IsValidZeroOrMoreAmount`).

What stays here: **creating and deleting** piggy banks, which belongs with §2.1's CRUD work rather
than with the budgeting feature.

### 2.4 Financial Overview & Reporting — **narrowed**

* **Current State:** Activity lists account balances and chronological transactions. `app/count.tsx`
  is the cash-envelope count/sweep and `src/reconcile/` is reconciliation — neither is reporting.
  There are no aggregate charts.
* **Superseded:** *Category Spending Breakdown* is what the bucket plan's Budget tab is
  (assigned / spent / available per envelope, per period, from `limit.spent` and
  `/v1/budgets?start&end`). Do not build it twice.
* **Still open:**
  - Monthly cash flow: income vs. expenses.
  - Net worth trend over time.
* **Note:** before building either, read the `dataviz` guidance — a chart in this app has to work in
  both themes and at phone width, and the shared `src/ui/` kit has no chart primitive yet. That
  absence is the real cost of this item, not the data.

### 2.5 ~~Android Notification & SMS Auto-Capture~~ — **discarded, 2026-10-11**

**Not building this.** It is written up here so it does not get re-proposed, not as a deferral.

The idea was sound on paper — `mmyway`'s `capture → inbox → confirm → sync` pipeline would take a
parsed bank notification as an `inbox_items` row in the `parsed` state, a state the machine already
has. Five things kill it:

1. **It is an open-ended text-parsing commitment.** A notification listener is only as good as its
   parser, and the parser is per bank, per locale, per notification format. Every bank that reskins
   its copy breaks it *silently* — the app simply stops capturing, which is the worst failure mode a
   finance app has. That is a maintenance treadmill a one-person app cannot win, and it never ends.
2. **It is native work in an otherwise managed app.** `expo-notifications` schedules and receives
   *this app's* notifications (`src/planned/notifications.ts`); reading *other apps'* needs
   `NotificationListenerService`, `BIND_NOTIFICATION_LISTENER_SERVICE` and a config plugin. There is
   no Expo-managed path, so it also has to be re-validated on every SDK upgrade.
3. **The SMS half is not even permitted.** `READ_SMS` is a Play restricted permission and a personal
   finance app is not an eligible use case under the SMS/Call Log policy. Asking risks the listing.
4. **It is the one feature that would undercut the privacy story.** A background service observing
   every notification on the device is a hard thing to put in a store listing next to "nothing
   leaves your phone", even though §4 makes that literally true.
5. **The marginal gain is small, because the gap is already covered.** Receipts go through the
   provider chain in `src/receipt/`; predictable spend goes through the Planned trio and the
   recurring review; and everything else is the amount-first capture screen, which exists precisely
   so that typing an amount is a two-second job. Automating away those two seconds is not worth
   items 1–4.

**If this is ever revisited**, the honest version is not a notification listener: it is Firefly III's
own Data Importer against a real bank feed (SimpleFIN, Nordigen/GoCardless), which is somebody
else's parser to maintain and already part of the ecosystem the app sits in.

### 2.6 Biometric App Lock — **done, 2026-10-11**

Settings → Security → Require unlock. `expo-local-authentication` (`~57.0.3`), the decision in
`src/lock/appLock.ts` (pure, tested), the overlay in `src/lock/LockGate.tsx` mounted once by
`app/_layout.tsx` after the `<Stack>` so it covers the modals too.

Three choices worth remembering:

- **No custom PIN screen.** `authenticateAsync` already falls back to the device
  PIN/pattern/password unless `disableDeviceFallback` is set, so a wet finger is an inconvenience
  rather than a lockout, and there is no second credential for this app to store.
- **The last-unlock time is never persisted.** It lives in a ref, so a cold start has nothing to
  compare against and therefore locks — which is what "lock on launch" has to mean. Persisting it
  would let killing and reopening the app walk straight past the lock.
- **Enabling it prompts first, and the toggle refuses when nothing is enrolled**
  (`canUseAppLock()` = hardware *and* enrolled). Both guard the same failure: being shut out of
  your own ledger by a lock the phone can no longer satisfy. The grace window is a constant
  (`LOCK_GRACE_MS`, 2 min), not a setting, chosen so that handing off to the camera for a receipt
  is not a re-lock.

Deliberately not done: `FLAG_SECURE` to blank the app in the recent-apps switcher. Different
concern (shoulder-surfing a thumbnail, not access) and it breaks screenshots.

### 2.7 Homelab Network & TLS Realities — **done, 2026-10-11**

* **Was already there:** plain `http://` to a LAN IP or tailnet name in release builds
  (`usesCleartextTraffic: true` in `app.config.js`'s `expo-build-properties` block), plus host
  reachability probing, multi-host failover and relayed-connection latency
  (`src/api/ff3/hosts.ts`, `src/sync/reachability.ts`, the 1.9.0 fix).
* **Private-CA HTTPS:** `plugins/withUserCaTrust.js` writes an Android network security config
  trusting `system` **and** `user` CAs, and points `<application>` at it. So a self-hoster whose
  Firefly III uses their own CA installs that CA on the phone and it works.
  - It does **not** disable verification, and should not: "trust anything" would put every install
    one bad Wi-Fi away from a man-in-the-middle on the whole ledger. A self-signed cert that is not
    installed on the device is still refused — that is the deliberate limit.
  - The config carries `cleartextTrafficPermitted="true"`. Not optional: once a network security
    config exists it overrides `android:usesCleartextTraffic` from API 24, so omitting it would
    have silently broken every plain-http instance. `plugins/withUserCaTrust.test.js` asserts it.
  - `expo-build-properties` has no option for this (checked), hence the plugin.
* **Reverse-proxy auth headers:** `src/api/ff3/proxyHeaders.ts` + Settings → Firefly III →
  Reverse proxy, with a Cloudflare Access preset.
  - Stored in SecureStore, not `app_settings` — they are credentials, and that file documents
    itself as non-secret.
  - Read by `createFF3Client` from a module-level snapshot rather than threaded through its call
    sites, so the **sign-in probe** and `imageSource` (receipt thumbnails) get them too. The
    sign-in path awaits `loadProxyHeaders()` itself, being the one moment a request can beat the
    snapshot.
  - Reserved names (`Authorization`, `Accept`, `Content-Type`, …) and CRLF-bearing values are
    refused at the storage boundary and re-filtered on read.
  - **HTTP Basic is deliberately not a header here.** It wants the same `Authorization` header as
    the Bearer token, so one would have to lose; the screen points at
    `https://user:pass@host` instead, which the host list already accepts.

### 2.8 Google Play Review Requirements — **still open**

A reviewer needs something to sign into. The two options stand, and one of them is now nearly free:

1. A public demo Firefly III instance with credentials in the review notes.
2. A built-in **Demo / Sandbox mode**. `tools/ff3-test/seed.json` already describes a complete,
   realistic set of accounts, categories, bills and transactions for the Maestro flows. Pointing a
   demo mode at that seed — served from the local SQLite cache with the outbox disabled — reuses
   work that exists instead of inventing fixtures.

Note what is *not* an answer: `app/e2e-sign-in.tsx`'s deep link. It answers only when
`extra.appVariant` is `development`/`preview`, and widening it would turn the production app into
something that can be pointed at an arbitrary server by a link (`AGENTS.md`: **never widen that**).

### 2.9 AI Receipt Business Model — **unchanged and correct**

* **Fixed Price Model:** for a fixed one-time purchase, hosting a central LLM proxy means recurring
  API cost against one-off revenue. No.
* **BYOK:** keep the current model — the user's own Gemini key (generous free tier) or a self-hosted
  local model (Ollama / vLLM), chained in `src/receipt/`.
* Reminder from `AGENTS.md`: never call a provider with a live key from a test; mock `fetch`.

---

## 3. Shipped since this document was first written

Listed so the §2 gaps stay honest. From `CHANGELOG.md`:

| | |
| :--- | :--- |
| Planned-transaction reminders (local notifications, day-of and 2 days before, Settings toggle) | 1.7.0 — this closed the research doc's "no reminders" gap entirely |
| Transaction tags as chips, everywhere a transaction is edited | 1.8.0 |
| Account reordering (drag, with the gesture surviving re-renders) | 1.7.2–1.8.0 |
| Payee aliases, N-to-1, with learning and JSON export/import | 1.9.0 |
| Host-reachability hardening for relayed/high-latency links | 1.9.0 |
| Currency-exchange receipts, deposit-voucher deduction, auto currency switch on account change | 1.10.0 |
| Split transactions, the cash count/envelope sweep, reconciliation | earlier |

---

## 4. The no-backend decision

Restated here because it is a commercial decision, not only an architectural one. The full argument
is `ynab-bucket-budgeting.md` §7.9; the short version:

Nothing in either plan needs a server of ours. Ready to Assign is derived (YNAB derives it too);
app-only state lives in Firefly III's own writable `notes` fields, for which this repo already has
the precedent (`mmyway-time:` in a recurrence's notes, `mmyway-envelope` in an account's,
`mmyway-reviewed` as a tag, and `mmyway-skip:` in the planned plan's Phase 4); and a phone can
schedule its own notifications, which v1.7.0 proved.

What a backend would buy is cross-device sync of app-only state and push notifications. For a
single-user self-hoster — who by definition already runs a server — neither is worth owning, and
owning it would mean the user's financial data on our box: GDPR, backups, an incident process, and
an exit path for every customer who stops paying. It also breaks §1.2's clean AGPL story, which
holds precisely *because* nothing of ours sits between the app and their Firefly III.

**Keep the product a client.** If something genuinely cannot live in Firefly III, the next cheapest
step is a marker in a `notes` field, then a file in the user's own storage — not a service we operate.

---

## 5. Suggested order

Not a schedule. An order, with the reason.

~~§2.6 biometric lock~~ and ~~§2.7 homelab network/TLS~~ are done (2026-10-11), as is the §2.5
discard. What is left, in order:

1. **`planned-transactions-plan.md` Phase 1** — raise the floor to 6.7.0 and delete the
   delete-and-recreate workaround. Pure subtraction, and it unblocks everything else in that plan.
2. **`ynab-bucket-budgeting-plan.md` Phases 1–3** — read-only Budget tab, assign, auto-fill. The
   headline feature, and Phase 1 cannot break anyone's ledger.
3. **§2.1 account CRUD** — unblocks §2.3's remainder and the liability work the bucket plan defers.
4. **`planned-transactions-plan.md` Phases 2–4** — the repetition editor and the skip.
5. **§2.8 demo mode** — do it before the store listing, not after the rejection.
6. **§2.4 cash flow + net worth** — needs a chart primitive in `src/ui/` first.
7. **§2.2 rules surface** — real, but the trio already covers the automation most users will set up.
