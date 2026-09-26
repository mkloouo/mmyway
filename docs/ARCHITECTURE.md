# Architecture

## Capture → Inbox → Confirm → Sync Pipeline

mmyway uses a state machine to manage financial entry capture and synchronization:

1. **Capture**: A user creates an entry—either manually or by uploading a receipt photo. The entry starts in the inbox as a draft.

2. **Parse** (for receipts): If a photo is provided, the receipt module sends it through a provider chain (local OpenAI-compatible model, then Gemini if needed) to extract merchant, amount, and category. The result feeds into the inbox as a suggested draft.

3. **Inbox**: Entries live in the inbox until confirmed. The inbox module manages the capture → parsed → confirmed → synced state machine shared across manual entries, receipts, and recurring-transaction reviews. This is the heart of the app's UX.

4. **Confirm**: Users review and finalize entries in the inbox. Confirmation is mandatory—no code path may push a create/edit/delete to the outbox without passing through the `confirmed` state. This ensures the user has always signed off before sync.

5. **Sync**: Once confirmed, the entry is queued in the outbox. The sync module manages write retries, reference-data pulls (categories, accounts, budgets from FF3), and deduplication. The user's local SQLite database is the source of truth for the UI; the outbox is the queue waiting for the next sync window.

## Module layout

- `src/db/` — Drizzle schema + migrations. SQLite is the source of truth for the UI.
- `src/api/ff3/` — hand-written FF3 client (fetch-based, no generated types — see note below).
- `src/sync/` — outbox (queued writes) and reference-data pulls. Read `src/sync/outbox.ts`'s
  header comment before changing replay order or retry semantics.
- `src/lookup/` — user aliases + merchant→category/account/budget history, pure functions.
- `src/suggest/` — ranks candidate values for an in-progress entry. Pure, offline, no tokens.
- `src/receipt/` — provider chain (local OpenAI-compatible model, then Gemini) that turns a
  photo into a draft. Never call a provider with a live key from a test — mock `fetch`.
- `src/inbox/` — the capture → parsed → confirmed → synced state machine shared by manual
  entries, receipts, and recurring-transaction reviews.
- `app/` — expo-router screens. Deliberately plain UI — the entry UX is still an open design
  question (brief §9 Q11); don't invest in polish here until that's settled.

## Key Rules

- **Never run a live write against the user's real FF3 instance or a real Gemini/local-model key from agent code.** Mock `fetch` in tests.
- **FF3 amounts are strings.** Never parse them to `number` for storage or arithmetic — use `src/api/ff3/decimal.ts`.
- **Categories are never hardcoded.** Always read from the `referenceCategories` table, synced from FF3. The old bot hardcoded them in 5 places; don't repeat that.
- **Confirm is mandatory.** No code path may push a create/edit/delete to the outbox without the inbox item having passed through the `confirmed` state.
- Generated files (`src/api/ff3/types.ts`, `src/db/migrations/**/*.sql`) must not be hand-edited. Edit `src/db/schema.ts` and run `npm run db:generate`.
