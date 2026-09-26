# Architecture

## Capture → Inbox → Confirm → Sync Pipeline

mmyway uses a state machine to manage financial entry capture and synchronization:

1. **Capture**: A user creates an entry—either manually or by uploading a receipt photo. The entry starts in the inbox as a draft.

2. **Parse** (for receipts): If a photo is provided, the receipt module sends it through a provider chain (local OpenAI-compatible model, then Gemini if needed) to extract merchant, amount, and category. The result feeds into the inbox as a suggested draft.

3. **Inbox**: Entries live in the inbox until confirmed. The inbox module manages the capture → parsed → confirmed → synced state machine shared across manual entries, receipts, and recurring-transaction reviews. This is the heart of the app's UX.

4. **Confirm**: Users review and finalize entries in the inbox. Confirmation is mandatory—no code path may push a create/edit/delete to the outbox without passing through the `confirmed` state. This ensures the user has always signed off before sync.

5. **Sync**: Once confirmed, the entry is queued in the outbox. The sync module manages write retries, reference-data pulls (categories, accounts, budgets from FF3), and deduplication. The user's local SQLite database is the source of truth for the UI; the outbox is the queue waiting for the next sync window.

## Module Layout

- **`src/db/`** — Drizzle schema + migrations. SQLite is the source of truth for the UI. Holds inbox state, confirmed entries, and synced reference data.

- **`src/api/ff3/`** — Hand-written Firefly III client (fetch-based, no generated types). Talks to the user's self-hosted FF3 instance. Amounts are always strings; see `decimal.ts` for safe arithmetic.

- **`src/sync/`** — Outbox (queued writes) and reference-data pulls. The outbox is retry-aware. Read `outbox.ts`'s header comment before changing replay order or retry semantics.

- **`src/lookup/`** — User aliases and merchant→category/account/budget history. Pure functions—no I/O. Powers suggestions and deduplication.

- **`src/suggest/`** — Ranks candidate values (accounts, categories, budgets) for an in-progress entry. Pure, offline, no tokens. Uses recency and frequency scores.

- **`src/receipt/`** — Provider chain: local OpenAI-compatible model (first choice, free), then Gemini fallback. Turns a photo into a draft entry. Never call a provider with a live key from test code—mock `fetch` instead.

- **`src/inbox/`** — The capture → parsed → confirmed → synced state machine. Shared by manual entries, receipts, and recurring-transaction reviews. The inbox is where the UX lives.

- **`app/`** — Expo-router screens. Deliberately plain UI—the entry UX is still an open design question. Don't invest in polish here until that's settled (see planning brief §9 Q11).

## Key Rules

- **Categories are never hardcoded.** Always read from the `referenceCategories` table, synced from FF3. The old bot hardcoded them in 5 places; don't repeat that.
- **Confirm is mandatory.** No code path bypasses it.
- **Never test against a live FF3 instance or real API keys.** Mock `fetch` in tests.
- Generated files (`src/api/ff3/types.ts`, `src/db/migrations/**/*.sql`) must not be hand-edited. Edit `src/db/schema.ts` and run `npm run db:generate`.
