import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const referenceAccounts = sqliteTable('reference_accounts', {
  id: text('id').primaryKey(), // FF3 server id
  name: text('name').notNull(),
  type: text('type').notNull(), // asset | expense | revenue | liability | ...
  currencyCode: text('currency_code').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  currentBalance: text('current_balance'), // decimal string, as of the last pull
  currentBalanceDate: text('current_balance_date'),
  notes: text('notes'), // carries the `mmyway-envelope` marker line among the user's own text
  // Asset-account settings edited on the account page (app/accounts/[id].tsx), as FF3 has them.
  accountRole: text('account_role'), // defaultAsset | sharedAsset | savingAsset | ccAsset | cashWalletAsset
  includeNetWorth: integer('include_net_worth', { mode: 'boolean' }).notNull().default(true),
  openingBalance: text('opening_balance'), // decimal string
  openingBalanceDate: text('opening_balance_date'), // YYYY-MM-DD
  virtualBalance: text('virtual_balance'), // decimal string
  creditCardType: text('credit_card_type'), // monthlyFull, only for ccAsset
  monthlyPaymentDate: text('monthly_payment_date'), // YYYY-MM-DD, only for ccAsset
  syncedAt: text('synced_at').notNull(),
});

export const referenceCategories = sqliteTable('reference_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  syncedAt: text('synced_at').notNull(),
});

export const referenceBudgets = sqliteTable('reference_budgets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  syncedAt: text('synced_at').notNull(),
});

export const referenceCurrencies = sqliteTable('reference_currencies', {
  code: text('code').primaryKey(), // e.g. PLN
  symbol: text('symbol').notNull(),
  decimalPlaces: integer('decimal_places').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false), // FF3's primary currency
  // FF3 knows every currency (BTC included) but only the enabled ones are in use; pickers offer those.
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  syncedAt: text('synced_at').notNull(),
});

export const cachedTransactions = sqliteTable('cached_transactions', {
  groupId: text('group_id').primaryKey(), // FF3 transaction group id
  journalId: text('journal_id').notNull(),
  type: text('type').notNull(), // withdrawal | deposit | transfer
  date: text('date').notNull(), // ISO 8601
  amount: text('amount').notNull(), // decimal string, never a number
  currencyCode: text('currency_code').notNull(),
  foreignAmount: text('foreign_amount'),
  foreignCurrencyCode: text('foreign_currency_code'),
  description: text('description').notNull(),
  sourceName: text('source_name'),
  destinationName: text('destination_name'),
  categoryName: text('category_name'),
  budgetName: text('budget_name'),
  // FF3 ids, so a renamed account or two accounts sharing a name don't break filters and edits.
  sourceId: text('source_id'),
  destinationId: text('destination_id'),
  budgetId: text('budget_id'),
  splitCount: integer('split_count').notNull().default(1), // amount is the splits' total when > 1
  searchKey: text('search_key'), // normkey'd description|source|destination, for case/diacritic-blind search
  tagsJson: text('tags_json').notNull().default('[]'),
  notes: text('notes'),
  updatedAt: text('updated_at').notNull(), // FF3's updated_at, for conflict checks
  syncedAt: text('synced_at').notNull(),
});

// Status columns carry `enum` for TypeScript only (Drizzle adds no CHECK constraint for text enums).
export const inboxItems = sqliteTable('inbox_items', {
  id: text('id').primaryKey(), // client-generated uuid
  kind: text('kind', { enum: ['manual_entry', 'receipt', 'recurring_review'] }).notNull(),
  state: text('state', { enum: ['captured', 'parsed', 'confirmed', 'synced', 'error'] }).notNull(),
  draftJson: text('draft_json').notNull(), // see src/inbox/draft.ts for the shape
  receiptImagePath: text('receipt_image_path'),
  receiptContentHash: text('receipt_content_hash'), // dedupe guard, see Review Focus
  ff3GroupId: text('ff3_group_id'), // set once synced
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const outboxOperations = sqliteTable('outbox_operations', {
  id: text('id').primaryKey(), // client-generated uuid, doubles as idempotency key
  inboxItemId: text('inbox_item_id'),
  kind: text('kind', { enum: ['create_transaction', 'update_transaction', 'delete_transaction', 'attach_receipt', 'recurring_review', 'update_account'] }).notNull(),
  payloadJson: text('payload_json').notNull(),
  status: text('status', { enum: ['pending', 'in_flight', 'failed', 'done'] }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  sequence: integer('sequence').notNull(), // strictly increasing, defines replay order
  nextAttemptAt: text('next_attempt_at'), // a failed op waits until then before the next automatic retry
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const aliases = sqliteTable('aliases', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // payee | account | budget | currency
  normalizedKey: text('normalized_key').notNull(),
  rawInput: text('raw_input').notNull(),
  targetId: text('target_id'), // FF3 id when known
  targetName: text('target_name').notNull(),
  createdAt: text('created_at').notNull(),
});
