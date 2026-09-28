# Component review: open TODOs

2026-09-28 · review of `app/` and `src/ui/` at `1ea6375`

Scope: the React Native components and screens, reviewed for code smells, YAGNI, KISS, memoization and readability. Data-layer modules (`src/sync/`, `src/inbox/`, …) were read only where a screen depends on them. Nothing below has been changed yet; tick items off here as they land.

Line numbers point at `1ea6375` and will drift.

## Status

**2026-09-28:** the bugs, the `AGENTS.md` rule violations and the cheap memo fixes are done (branch `claude/compassionate-ramanujan-v1kniz`). The duplication, YAGNI and readability refactors are still open.

## Summary

The kit is in good shape: one theme, one `Sheet`, one `PickerSheet`, `TextField`, `SearchField`, `useAction`, and screens mostly draw from it. The debt is concentrated in three places:

1. **Two screens hold one split editor twice.** `app/draft/[id].tsx` (525 lines) and `app/transactions/[groupId].tsx` (662 lines) each carry their own copy of the split pager, the keypad and text sheets, leftover placement and payee-per-split.
2. **Screens still bypass the rules in `AGENTS.md`**: `JSON.parse` on `payload_json`/`draft_json` in five places, table writes and outbox payloads built inside screens, and async `Alert` handlers that escape `useAction`.
3. **Memoization is either missing where it matters or defeated.** `Snackbar`'s timer restarts on every Inbox render, `useTheme()` returns a new object each call, and the one `memo` row list (`ActivityRow`) re-renders on every sync because `useLiveQuery` hands back a new currencies array.

React Compiler is not enabled (`app.config.js` has only `typedRoutes`), so every `memo`, `useMemo` and `useCallback` is manual. The guidance at the end says where they earn their place.

## Bugs found while reviewing

These change behaviour today; fix before the refactors.

- [x] **Snackbar outlives its Undo window on the Inbox.** `app/(tabs)/index.tsx:413` passes `onDismiss={() => setSnackbar(null)}`, a new function on every render. `Snackbar`'s effect depends on it (`src/ui/Snackbar.tsx:21-25`), so each Inbox re-render restarts the 5 s timer. The Inbox re-renders on every live-query tick, and the post-confirm sync at 6 s changes rows, so the snackbar stays up past the undo window. A delete's Undo tapped after `UNDO_WINDOW_MS` then does nothing visible (the delete timer already committed), and a confirm's Undo says "Already sent". Capture and the draft screen already pass a `useCallback`. Fix both ends: `const dismissSnackbar = useCallback(() => setSnackbar(null), [])` in the Inbox, and make `Snackbar` key its timer on `entry?.id` only, holding `onDismiss` in a ref, so no caller can reintroduce this.
- [x] **Render can crash on a malformed queued payload.** `app/transactions/[groupId].tsx:148` runs `JSON.parse(op.payloadJson).groupId` during render with no `try`. One bad row in the outbox blanks the detail screen into the error boundary. Use `readPayload` (see the next section).
- [x] **Draft edits fail silently.** `patch()` in `app/draft/[id].tsx:121-123` calls `updateDraft(db, id, fields)` without `await` or `catch`. Every keypad digit, detail change and split edit on the draft screen goes through it; a failed write becomes an unhandled rejection that release builds drop. Route it through `useAction` or at least `.catch(reportErrors…)`.
- [x] **Async work inside `Alert` buttons escapes error handling.** The `onPress` of a destructive `Alert.alert` runs after the surrounding `act()` has resolved, so a failure there is unhandled: sign-out (`app/(tabs)/settings.tsx:180-191`), draft delete (`app/draft/[id].tsx:193`), transaction delete (`app/transactions/[groupId].tsx:358-361`) and alias remove (`app/settings/aliases.tsx:301`). `src/ui/confirm.ts`'s `confirmDestructive()` already exists for this: `if (!await confirmDestructive(...)) return;` inside an `act()` keeps the whole handler covered. `app/planned/[key].tsx:417` gets it right by wrapping the `onPress` in `act()`.
- [x] **Unguarded async setters in pickers.** `PickerSheet` `onSelect` handlers in Settings (`app/(tabs)/settings.tsx:368, 374, 380, 387`), the cash-count settings chips (`app/count.tsx:310-323`) and the Planned mode chips (`app/(tabs)/planned.tsx:41`) are `async` with no error path. Wrap each in `act()`.
- [x] **Merchant history effects have no cancellation.** `app/draft/[id].tsx:80-83`, `app/transactions/[groupId].tsx:120-123` and `app/planned/[key].tsx:359-361` call `buildMerchantLookup(...).then(setHistories)` with no `cancelled` flag. Switching the type quickly can land the older lookup last. Capture (`app/capture.tsx:126-131`) does it right. Fixed for free by the `useMerchantHistories` hook below.
- [x] **Two definitions of a "dirty" amount in Capture.** `isDirtyAmount` (`app/capture.tsx:54-56`) treats `"0,"` as clean; `isDirty = amount !== '0'` (`:206`) treats it as dirty. The FX guard uses one and the discard prompt the other. Keep one.

## Rules from AGENTS.md that screens still break

- [x] **`JSON.parse` + cast on stored JSON.** `AGENTS.md` says `draft_json`/`payload_json` go only through `src/inbox/draftJson.ts` and `src/sync/payloadJson.ts`. Still parsed by hand in:
  - `app/transactions/[groupId].tsx:148` (payload `groupId`, see bug above)
  - `app/(tabs)/activity.tsx:293` (pending deletes)
  - `src/ui/InboxCards.tsx:233` (errored draft label) and `:250` (conflict `groupId`)

  A small `payloadGroupId(op): string | null` in `src/sync/payloadJson.ts` covers three of them. Done: `payloadGroupId`, and `readDraft` for the errored card; Activity's queued-create rows also skip an unreadable payload instead of throwing.
- [x] **Table writes and outbox payloads inside screens.** `AGENTS.md`: "table writes live in `src/`, not in the screen". Remaining offenders:
  - `app/transactions/[groupId].tsx:335-339` builds an `update_transaction` operation and `:359` a `delete_transaction`. Move to `src/transactions/` next to `queueSplitEdit` (`queueTransactionEdit`, `queueTransactionDelete`).
  - `app/(tabs)/activity.tsx:222-227` upserts a remote search hit into `cached_transactions`. Move to `src/transactions/` (`cacheRemoteResult`).
  - `app/(tabs)/activity.tsx:238-259` calls `client.request('/v1/search/transactions?…')` from the screen. Move the request to `src/api/ff3/` and the state to a `useRemoteSearch(query)` hook in `src/transactions/`.
  - `app/(tabs)/settings.tsx:315-322` probes the local model with a raw `fetch`. Move beside the local provider (`src/receipt/providers/local.ts`).

  Done: `src/transactions/queueEdit.ts`, `src/transactions/remoteSearch.ts` (`searchTransactions`, `cacheRemoteResult`) and `probeLocalModel`, which sync's reachability probe now shares. The remote-search *state* is still in the screen; moving it into a `useRemoteSearch` hook is left for the Activity split under Readability.
- [x] **Search folds case with `toLowerCase`.** `app/settings/aliases.tsx:283-284` filters with `toLowerCase()` (and recomputes `search.trim().toLowerCase()` three times per row). Everywhere else uses `normkey`, which was the fix for "żabka"/"Żabka". Use `normkey`.

## Duplication to fold into the kit

Ordered by how much code each removes.

- [ ] **One split editor for the draft and transaction screens.** Both screens implement `placeLeftover`, `askLeftover`, `closeKeypad`, `removeSplit`, `renderSplitPage`, the keypad sheet keyed by `keypadFor`, the text sheet keyed by `textFor`, the per-split payee sheet and the `AllocationSheet` wiring (`app/draft/[id].tsx:197-331, 445-499`; `app/transactions/[groupId].tsx:245-297, 437-471, 588-643`). They differ only in where an edit is written (the draft row vs local `edited` state). Extract a `useSplitEditor({ splits, total, write })` hook in `src/splits/` plus a `SplitPage` component in `src/ui/`. This is the largest single cut, roughly 250 lines.
- [ ] **Loader + editor split for the two detail screens.** `app/draft/[id].tsx` uses `draft!` about 14 times and `app/transactions/[groupId].tsx` uses `row!` about 12 times, because functions declared after the early `return` lose the narrowing. `app/planned/[key].tsx:304-323` already shows the fix: the route component loads and guards, then renders `<PlannedEditor item={item} />` with a non-null prop. Do the same (`DraftEditor`, `TransactionEditor`, and `ConflictView` for the conflict branch at `app/transactions/[groupId].tsx:366-409`).
- [ ] **One searchable list sheet.** `AccountPickerSheet`, `TargetPickerSheet` and `PayeeSheet` each repeat the `Sheet scroll={false}` + `SearchField` + `FlatList` + bordered pressable row + "No matches" empty text + "use new name" footer + `setQuery('')` on every close/select path. Extract `SearchListSheet<T>({ items, filter, renderRow, onSelect, footer })`; the three become thin wrappers.
- [ ] **`PhotoViewer`.** The full-screen photo `Modal` is copied between `app/draft/[id].tsx:513-517` and `app/transactions/[groupId].tsx:650-654` (the comment even says "Same full-screen view as the draft screen's"). Move it to `src/ui/`.
- [ ] **`CloseButton`.** Defined identically at the bottom of `app/draft/[id].tsx:522-525` and `app/transactions/[groupId].tsx:659-662`, and inlined as `<BarIconButton icon="close" … onPress={() => router.back()} />` in `count.tsx`, `receipt.tsx`, `accounts/[id].tsx` and `planned/[key].tsx`. Add it to `src/ui/components.tsx`.
- [ ] **`Banner`.** The warn strip `View(warnSoft) > Text(label, warn)` is hand-built five times: Inbox offline (`app/(tabs)/index.tsx:316-320`), count stale and count blocker (`app/count.tsx:166-181`), draft error (`app/draft/[id].tsx:368-372`) and the split leftover (`src/ui/SplitPager.tsx:52-61`). Add `Banner({ tone, children, action })` to the kit.
- [ ] **`Dot`.** `{ width: 8, height: 8, borderRadius: 4, backgroundColor }` appears 10 times across `app/` and `src/ui/`. Add `Dot({ color, size })`; `PendingDot` becomes a use of it.
- [ ] **Pressed-opacity style.** `opacity: pressed ? 0.6 : 1` is written 18 times (plus one `0.7` in `aliases.tsx:354`). A `pressedStyle` helper or a `Tappable` wrapper keeps the value in one place.
- [ ] **`Fab`.** The round accent button is drawn in `CaptureDock` and again in `app/settings/aliases.tsx:348-358`; `CaptureDock`'s two round icon buttons are also copies of each other (`src/ui/CaptureDock.tsx:19-42`). Extract `DockButton`/`Fab`.
- [ ] **`ChipRow` in Capture.** The labelled horizontal `ScrollView` with a 🔍 chip and account chips is written three times (`app/capture.tsx:401-439`), and the transfer branch duplicates the non-transfer one. One `AccountChipRow({ label, selectedId, onSelect, onSearch, exclude })` removes about 40 lines.
- [ ] **Shared hooks for repeated queries.**
  - `useLiveQuery(db.select().from(referenceCurrencies))` appears in 8 screens, categories and budgets in 4 each. Add `useCurrencies()`, `useCategories()`, `useBudgets()` next to `useAssetAccounts`, returning `[]` rather than `undefined` so the `?? []` at every call site goes too.
  - The `hasSyncedBefore` probe (`limit(1)` on `cached_transactions`) is copied in Inbox and Activity: `useHasSyncedBefore()`.
  - `buildMerchantLookup` + `useState` + effect in four screens: `useMerchantHistories(type)` with cancellation. Done for draft, transaction and planned (`src/lookup/useMerchantHistories.ts`); Capture keeps its own, which seeds from the startup preload.
  - Multi-select (`selectedIds`, `toggleSelected`, `leavingIds`) in Inbox and Activity: `useSelection()`.
  - The unsaved-changes back handler in Capture (`app/capture.tsx:208-228`) and the account page (`app/accounts/[id].tsx:109-125`): `useConfirmDiscard(dirty)`.
- [ ] **Small utils.** The local `YYYY-MM-DD` formatter is written four times (`activity.tsx:123`, `accounts/[id].tsx:43`, `planned/[key].tsx:300`, `src/planned/usePlanned.ts:12`); `STALE_MS` and the "balance older than a day" test twice (`activity.tsx:50, 438`, `count.tsx:36, 111`); `err instanceof Error ? err.message : String(err)` 15 times. Add `localDay()`, `isBalanceStale()` and `errorMessage()` to `src/utils/`.
- [ ] **The type list.** `{ withdrawal → capture.typeExpense, … }` is declared in `app/capture.tsx:48`, `app/planned/[key].tsx:286` and `app/transactions/[groupId].tsx:47`. One exported constant.

## YAGNI and KISS

- [ ] **`useCaptureForm` is `useState` in disguise.** `src/capture/useCaptureForm.ts` builds a reducer, then generates one `setX` per field through string templating and `as unknown as` casts, and Capture destructures 30 names from it (`app/capture.tsx:91-97`). The only action with meaning is `saved`. Either return `{ form, set(patch), markSaved }` (one generic `set`, typed with `Partial<CaptureForm>`) or give the reducer real domain actions (`changeType` clearing the payee, as `app/planned/[key].tsx:390-399` does). Both drop the metaprogramming.
- [ ] **One sheet at a time, one state.** Capture has 7 `…SheetOpen` booleans, Settings 9, the draft and transaction screens 4-6 each, and only one sheet can be open. `app/planned/[key].tsx:337` already uses `useState<'amount' | 'currency' | … | null>`. Do the same elsewhere.
- [ ] **Settings mirrors storage into 12 `useState`s.** `app/(tabs)/settings.tsx:73-105` loads every setting into its own state, re-sets all 12 in `reload()`, and calls `reload()` again from sheet `onClose`. TanStack Query is already installed: one `useQuery(['settings'], loadSettings)` with `invalidateQueries` after each write replaces the state, `reload`, and the IIFE-in-effect with its `eslint-disable` (`:105`).
- [x] **Settings re-implements `useToast`.** `app/(tabs)/settings.tsx:107-112` is `src/ui/useToast.ts` line for line.
- [ ] **In-flight guards written four ways.** `saving`/`confirming`/`approving`/`busy` + `try/finally` appears in Capture, the draft, transaction, account, planned, count, Settings (`saveOnce`), Inbox (`savingReview`, `confirmingAll`), `ReviewCard` and `AddressesSheet` (three guards in one sheet). Fold into `useAction`: have it return `[run, pending]` and drop calls while `pending`, so a screen only reads the flag for the button label.
- [ ] **Two keypad sheets for one amount.** The draft and transaction screens each have `amountSheetOpen` for the single-split amount and `keypadFor` for split amounts, and `keypadFor === 0` already means "the first amount". Use `keypadFor` alone.
- [ ] **`AllocationSheet`'s `visible` prop.** Both callers mount it only while open and pass `visible` hard-coded (`app/draft/[id].tsx:487`, `app/transactions/[groupId].tsx:634`); the component even documents "Mounted fresh for each use". Drop the prop and pass `visible` to `Sheet` directly.
- [ ] **`AllocationSheet` computes `defaultShares(target, caps)` three times** (`src/ui/AllocationSheet.tsx:50, 59, 67`); `chooseSplits` and `takeDefault` repeat the same guard. Compute it once per render.
- [ ] **`OP_KIND_KEYS` is an identity map.** `src/ui/InboxCards.tsx:25-34` maps each kind to `inbox.opKind.<kind>`. Keep it only if Tolgee's key extraction needs literal keys (see `docs/LOCALIZATION.md`); otherwise `tr(\`inbox.opKind.${op.kind}\`, { defaultValue: tr('inbox.opKind.other') })`.
- [ ] **Leftovers.** `const shown = index;` in `src/ui/SplitPager.tsx:31` aliases a prop; a `View` wrapping a single `TextField` in `src/ui/AddressesSheet.tsx:124-133`; a double blank line at `app/count.tsx:37-38`; `onPress={() => !readOnly && …} disabled={readOnly}` guards twice (`app/draft/[id].tsx:348, 352`); `new Date().getTime()` where `Date.now()` reads better (`activity.tsx:438`, `count.tsx:111`); the long-press on Settings → Accounts rows does the same as a tap (`app/settings/accounts.tsx:78-79`).
- [ ] **Stale header comment.** `src/ui/components.tsx:1-2` says "Ten primitives, no styling outside this file". There are 16 exports here and 21 more component files in `src/ui/`. Reword to what holds: screens take styling from the kit and `useTheme()`, not from literals.

## Memoization (React Native)

No React Compiler, so memo is manual. The rule this codebase should follow: memoize list rows that render many times and the props they receive; don't wrap everything.

- [x] **`useTheme()` returns a new object on every call.** `src/ui/theme.ts:100-107` builds `{ dark, color, space, radius, type }` each time, so any `useMemo`/`memo` that gets `t` as a dependency or prop never hits. Build the two themes once (`const LIGHT = themeFor('light')`, `DARK = …`) and return one of them.
- [ ] **`ActivityRow` re-renders on every sync.** It is correctly `memo`ed with stable callbacks (`app/(tabs)/activity.tsx:347-373, 545`), but its `currencies` prop comes from `useLiveQuery`, which sets a new array on every change event to `reference_currencies`, and the per-sync `syncedAt` bump fires one. Pass the resolved `DisplayCurrency` per row instead of the list, or make `useLiveQuery` keep the previous array when rows are equal (a shallow compare on the result).
- [ ] **Inbox cards parse every draft on every render.** `readyToConfirm` (`app/(tabs)/index.tsx:156-159`), `confirmSelected` (`:201`) and each `ConfirmCard` (`src/ui/InboxCards.tsx:92-93`) run `readDraft` (zod) + `draftReadiness` per item, and the Inbox re-renders on every live-query tick. Parse once in `useInboxSections` and hand rows `{ item, draft, readiness }`; the "is confirmable" predicate (receipt not `captured` and ready) is also duplicated between `:156` and `:201`.
- [ ] **Inbox cards are not memoized, and can't be yet.** `renderItem` builds new `onOpen`/`onConfirm`/`onDelete` closures and a new `selection` object per row (`app/(tabs)/index.tsx:386-406`). Only worth changing if the Inbox grows long: pass `id` + stable callbacks (the `ActivityRow` pattern) and `memo` the cards. Until then, leave it; `memo` with inline props is pure overhead.
- [x] **`Pulse` keeps its `Animated.Value` in `useMemo`.** `src/ui/components.tsx:326`. React treats `useMemo` as a cache it may drop; `feedback.ts`, `Keypad` and `Collapsible` all use `useState(() => new Animated.Value(…))`. Match them.
- [x] **`useFlyAway` rebuilds interpolations every render.** `src/ui/feedback.ts:66-72` creates three `interpolate` nodes per render of Capture. Wrap `ghostStyle` in `useMemo([out])`.
- [ ] **Sheets query while closed.** `PayeeSheet` (`src/ui/PayeeSheet.tsx:32`) and `TargetPickerSheet` (`:22`) run a live query from mount, even while hidden; the draft screen mounts two `PayeeSheet`s. Pass the rows in from the screen, or query only while `visible`.
- [ ] **`useLiveQuery`'s `deps` default is a footgun.** The hook ignores a changed query unless `deps` is passed (`src/db/useLiveQuery.ts:13, 53`). `accounts/[id]` passes `[id]`, but `draft/[id].tsx:50` and `transactions/[groupId].tsx:77, 90` build `where(eq(…, id))` without it. Harmless while each route push mounts a fresh screen; wrong the day a screen is reused with new params. Pass the ids, or make `deps` required when the query has a `where`.

## Readability

- [ ] **Screen size.** After the extractions above, target: `transactions/[groupId].tsx` 662 → ~300, `activity.tsx` 608 → ~350 (move `QueuedRow`/`RemoteResultRow`, `mapRemoteResult`, `landingRow`, `cachedSplitLines` and the outbox-derived rows into `src/transactions/`; `ActivityRow` and the balance strip into their own files), `capture.tsx` 541 → ~380, `draft/[id].tsx` 525 → ~250, Inbox 459 → ~330 (move the edit-review sheet into `src/ui/InboxCards.tsx` or its own file).
- [ ] **Parallel ternary chains.** The Inbox computes `pillState` and `pillLabel` with two chains over the same five conditions (`app/(tabs)/index.tsx:266-277`); one `syncPill(...) → { state, label }` keeps them in step. The same for the textbox value/setter pairs keyed on `textFor` (`app/draft/[id].tsx:457-462`).
- [ ] **`readOnly ? undefined : …` seven times** in `src/ui/DetailRows.tsx:53-93`, with `chevron={!readOnly}` on each row. An `editable(fn)` helper, or `Row` reading `onPress` presence for its chevron, removes the repetition.
- [ ] **Receipt rows' `first`/`label` logic** in `app/transactions/[groupId].tsx:543-561` repeats `!attachments.data?.length && queued.length === 0` three times. Build one array of rows and use the index.
- [ ] **Activity footer.** Five near-identical `Text` blocks for the remote-search states (`app/(tabs)/activity.tsx:505-529`). Map status to key and tone.
- [ ] **Non-null props in `Keypad`.** `dateLabel!`, `onDatePress!`, `onNotePress!` (`src/ui/Keypad.tsx:69-70`) are asserted because `compact` makes them optional. A discriminated union (`{ compact: true } | { compact?: false; dateLabel; onDatePress; onNotePress }`) lets TypeScript check the callers; the spacer `View` there is also written twice.
- [ ] **Indentation.** `Animated.View` children not indented in `src/ui/InboxCards.tsx:81-87, 114-146` and `src/ui/Keypad.tsx:20-43`; the `SectionList` branch in `app/transactions/[groupId].tsx:491-535` and the `AppBar` ternary at `app/(tabs)/index.tsx:303-315`. Prettier is configured (`.prettierrc.json`) but has no npm script and isn't in `npm run check`; a `format` script, or a lint rule, would settle this for good.
- [ ] **The `navigation` cast.** `app/(tabs)/activity.tsx:380` casts `useNavigation()` to a hand-written type to reach `addListener('tabPress')`. Type it as `useNavigation<BottomTabNavigationProp<…>>()`.
- [ ] **Money formatting on the cash count.** `app/count.tsx:206, 244, 299` render amounts as `${amount} ${symbol}` / `${amount} ${code}`, while every other screen uses `Money`/`formatMoney` with the phone's number format. Use `formatMoney`.
- [ ] **Free-text currency on the recurring edit.** The Inbox's edit-review sheet takes the currency as a `TextField` and the account as a wall of chips (`app/(tabs)/index.tsx:440-453`), where Capture uses `PickerSheet` and `AccountPickerSheet`. Reuse those.
- [ ] **Accessibility gaps.** `Button` has no `accessibilityLabel` prop, so the "📷" button on the empty Inbox (`app/(tabs)/index.tsx:351`) reads as an emoji; Capture's currency toggle (`app/capture.tsx:318`) and ✕ (`:310`, a `Text` glyph instead of `BarIconButton`) have no or thin labels; aliases' remove button borrows the `addresses.removeAddress` key (`app/settings/aliases.tsx:340`). Add the prop and proper keys.
- [ ] **`ErrorBoundary` logs during render.** `app/_layout.tsx:177` calls `logLine` in the render body, so every re-render of the error screen logs again. Move it into an effect.

## From device testing (2026-09-28)

Deferred on purpose; to be handled by hand.

- [ ] **Ukrainian strings.** Some machine translations read wrong, for example the planned editor's Repeats hint ("Знижка за одноразовий платіж") and "Кожен період" without its count. Fix in Tolgee, then `npm run i18n:pull`.
- [ ] **Planned list cards.** The simple view's cards spend their width badly: the schedule line truncates the payee ("Zina Mishchen…", "BOGART Wiol…"), and what matters (amount, next date, payee) competes with what doesn't. Rework the card layout in `app/(tabs)/planned.tsx`.

## Memo guidance for new code

- Use `memo` on a component only when it renders in a list (or is otherwise expensive) **and** its parent can give it stable props: ids and primitives, callbacks from `useCallback`, values from `useMemo` or the state setter itself. `ActivityRow` is the reference.
- Don't `useCallback` a handler that is only passed to a non-memo child or a DOM-like primitive (`Pressable`); it costs more than it saves.
- `useMemo` for derived collections that parse, sort or filter many rows (`displaySections`, the outbox-derived rows in Activity), not for a `find` over a handful of items.
- Keep objects that must survive renders (`Animated.Value`, timers) in `useState(() => …)` or `useRef`, never `useMemo`.
- An effect that depends on a callback prop should hold the callback in a ref if the caller is likely to pass an inline arrow (the `Snackbar` bug above).
- If this list keeps growing, consider turning on React Compiler (`experiments.reactCompiler` in `app.config.js`) and deleting the manual memos instead; test it on a device build first.
