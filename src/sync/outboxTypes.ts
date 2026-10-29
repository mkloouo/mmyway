import type { Href } from 'expo-router';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from '../db/schema';
import type { TransactionSplit } from '../api/ff3/types';
import type { EditChanges } from '../transactions/editDiff';
import type { AccountEdit } from '../accounts/accountEdit';
import type { FF3Client } from '../api/ff3/client';
import type {
  DeletePlannedPayload,
  SavePlannedPayload,
  TriggerPlannedPayload,
} from '../planned/replay';
import type { SetBudgetLimitsPayload, SetPiggyAmountPayload } from '../bucket/replay';
import type {
  CreateBudgetPayload,
  UpdateBudgetPayload,
  DeleteBudgetPayload,
} from '../bucket/budgetActions';
import type { CreateAccountPayload } from '../accounts/accountCreate';
import type {
  CreateRulePayload,
  ToggleRuleGroupPayload,
  ToggleRulePayload,
  TriggerRulePayload,
} from '../rules/replay';

export type OutboxKind =
  | 'create_transaction'
  | 'update_transaction'
  | 'delete_transaction'
  | 'attach_receipt'
  | 'delete_attachment'
  | 'recurring_review'
  | 'update_account'
  | 'reorder_accounts'
  | 'save_planned'
  | 'delete_planned'
  | 'trigger_planned'
  | 'set_budget_limits'
  | 'set_piggy_amount'
  | 'create_budget'
  | 'update_budget'
  | 'delete_budget'
  | 'create_account'
  | 'toggle_rule'
  | 'toggle_rule_group'
  | 'trigger_rule'
  | 'create_rule';

/** Kinds that may change balances: account saves include opening balances, and triggers book/edit transactions. */
export const LEDGER_KINDS = [
  'create_transaction',
  'update_transaction',
  'delete_transaction',
  'recurring_review',
  'create_account',
  'update_account',
  'trigger_planned',
  'trigger_rule',
] as const satisfies readonly OutboxKind[];

export interface CreateTransactionPayload {
  clientId: string; // becomes the duplicate-hash guard
  splits: TransactionSplit[];
  groupTitle?: string; // FF3 requires one when there is more than one split
}

export interface UpdateTransactionPayload {
  groupId: string;
  transactionJournalId: string;
  expectedUpdatedAt: string; // conflict check
  changes: EditChanges;
  splits?: (Partial<TransactionSplit> & { transaction_journal_id?: string })[];
  groupTitle?: string;
  removedJournalIds?: string[];
  applied?: boolean;
}

export interface DeleteTransactionPayload {
  groupId: string;
  expectedUpdatedAt?: string;
}

export interface AttachReceiptPayload {
  transactionJournalId: string;
  receiptImagePath: string;
  attachmentId?: string;
}

export interface DeleteAttachmentPayload {
  attachmentId: string;
  transactionJournalId: string;
}

export interface UpdateAccountPayload {
  accountId: string;
  setEnvelopeMarker?: boolean;
  active?: boolean;
  order?: number;
  edit?: AccountEdit;
}

export interface ReorderAccountsPayload {
  orderedIds: string[];
}

export type OutboxDb = BaseSQLiteDatabase<'sync', any, typeof schema>;

export type OutboxRow = typeof schema.outboxOperations.$inferSelect;

export interface NewOutboxOperation {
  id: string;
  inboxItemId?: string;
  kind: OutboxKind;
  payload:
    | CreateTransactionPayload
    | UpdateTransactionPayload
    | DeleteTransactionPayload
    | AttachReceiptPayload
    | DeleteAttachmentPayload
    | UpdateAccountPayload
    | ReorderAccountsPayload
    | SavePlannedPayload
    | DeletePlannedPayload
    | TriggerPlannedPayload
    | SetBudgetLimitsPayload
    | SetPiggyAmountPayload
    | CreateBudgetPayload
    | UpdateBudgetPayload
    | DeleteBudgetPayload
    | CreateAccountPayload
    | ToggleRulePayload
    | ToggleRuleGroupPayload
    | TriggerRulePayload
    | CreateRulePayload
    | Record<string, unknown>;
}

export interface ReplayResult {
  succeeded: string[];
  conflicted: string[];
  failedAt: string | null;
}

export type ConflictHandler = (
  op: { id: string; payload: UpdateTransactionPayload | DeleteTransactionPayload },
  serverUpdatedAt: string,
) => void;

export type ReplayOutcome = 'done' | 'conflict' | 'failed' | 'unreachable' | 'returned';

export interface ReplayContext {
  db: OutboxDb;
  client: FF3Client;
  opts?: { onConflict?: ConflictHandler };
}

export interface QueuedChangeInfo {
  subject: string | null;
  route: Href | null;
  changed: string[];
}

export interface QueuedChangeLookups {
  transaction: (by: {
    groupId?: string;
    journalId?: string;
  }) => { description?: string | null; groupId: string } | undefined;
  accountName: (id: string) => string | undefined;
}

export interface KindSpec<P = any> {
  subjects: (payload: P, add: (prefix: string, value: unknown) => void) => void;
  describe: (
    payload: P,
    op: { inboxItemId: string | null },
    lookups: QueuedChangeLookups,
  ) => QueuedChangeInfo;
  replay: (ctx: ReplayContext, payload: P, row: OutboxRow) => Promise<ReplayOutcome>;
}
