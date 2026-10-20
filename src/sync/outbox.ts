// Outbox replay rules (brief §5.4):
// - Operations replay in strict `sequence` order, one at a time.
// - A create is safe to retry: it carries `internal_reference: mmyway:<clientId>` (part of FF3's
//   duplicate hash) and `error_if_duplicate_hash: true`, so a retried request that already
//   landed comes back as a duplicate of our own transaction and is recorded as a success.
// - An edit/delete compares `updated_at` — the cached one, then the server's own copy — before
//   sending; a mismatch is a conflict, not an overwrite (Review Focus: conflicting edits).
// - Each op is claimed (-> in_flight) just before it is sent; a finished op is deleted.
// - A failure holds back only the later operations that depend on it: the ones sharing a subject
//   (the same transaction, Inbox entry, account or planned transaction; src/sync/outboxSubjects.ts),
//   and in turn the ones depending on those. Unrelated operations go ahead (#41). A failure that
//   says FF3 can't be reached at all (no answer, 5xx, 401/403, 429) still stops the whole run, since
//   everything after it would fail the same way; so does an operation whose payload can't be read.
// - A failed op backs off (retryDelayMs): until its next_attempt_at it is not re-sent, and the
//   operations depending on it wait with it. "Retry now" in the Inbox sets it back to `pending`,
//   which skips the wait.

export type {
  AttachReceiptPayload,
  ConflictHandler,
  CreateTransactionPayload,
  DeleteAttachmentPayload,
  DeleteTransactionPayload,
  NewOutboxOperation,
  OutboxDb,
  OutboxKind,
  OutboxRow,
  ReorderAccountsPayload,
  ReplayResult,
  UpdateAccountPayload,
  UpdateTransactionPayload,
} from './outboxTypes';
export { LEDGER_KINDS } from './outboxTypes';

export { OUTBOX_KINDS } from './outboxKinds';

export {
  describeFF3Error,
  describeFf3Error,
  internalReferenceFor,
  serverUnavailable,
} from './outboxErrors';

export {
  deleteCachedTransactions,
  discardOperation,
  dropQueuedChange,
  enqueueOperation,
  enqueueOperationSync,
  isUnsent,
  keepMineOverServer,
  mayHaveLanded,
  neverSent,
  queuedLedgerOpCount,
  recoverInFlight,
  retryOperationNow,
} from './outboxQueue';

export { replayOutbox, retryDelayMs } from './outboxReplay';

export { pruneUploadedReceiptImages } from './receiptPruning';
