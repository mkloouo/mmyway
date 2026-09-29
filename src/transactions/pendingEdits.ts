// Edits to already-synced transactions that are saved on the phone but not yet in FF3: queued
// updates (the detail screen's Save, a recurring review), and receipt uploads. Activity marks
// those rows and shows the edited values, instead of the server copy that is about to change.
// Pure, no db.
import type { TransactionSplit } from '../api/ff3/types';

export type PendingEditStatus = 'queued' | 'failed' | 'conflict';

export interface PendingEdit {
  status: PendingEditStatus;
  /** Every queued change to the transaction, merged in replay order. */
  changes: Partial<TransactionSplit>;
  /** The latest queued split edit's splits (every split, as they'll be), if one is queued. */
  splits?: QueuedSplit[];
  groupTitle?: string;
}

export type QueuedSplit = Partial<TransactionSplit> & { transaction_journal_id?: string };

interface OutboxRow {
  kind: string;
  status: string;
  lastError: string | null;
  sequence: number;
  payloadJson: string;
}

const RANK: Record<PendingEditStatus, number> = { queued: 0, failed: 1, conflict: 2 };

function statusOf(op: OutboxRow): PendingEditStatus {
  if (op.status !== 'failed') return 'queued';
  return op.lastError === 'conflict' ? 'conflict' : 'failed';
}

function worse(a: PendingEditStatus, b: PendingEditStatus): PendingEditStatus {
  return RANK[b] > RANK[a] ? b : a;
}

export interface PendingEdits {
  byGroup: Map<string, PendingEdit>;
  /** attach_receipt is keyed by journal, not group. */
  byJournal: Map<string, PendingEditStatus>;
}

export function pendingEdits(outbox: readonly OutboxRow[]): PendingEdits {
  const byGroup = new Map<string, PendingEdit>();
  const byJournal = new Map<string, PendingEditStatus>();
  const ops = [...outbox].sort((a, b) => a.sequence - b.sequence);
  for (const op of ops) {
    const isUpdate = op.kind === 'update_transaction' || op.kind === 'recurring_review';
    if (!isUpdate && op.kind !== 'attach_receipt') continue;
    let payload: {
      groupId?: string;
      transactionJournalId?: string;
      changes?: Partial<TransactionSplit>;
      splits?: QueuedSplit[];
      groupTitle?: string;
    };
    try {
      payload = JSON.parse(op.payloadJson);
    } catch {
      continue;
    }
    const status = statusOf(op);
    if (isUpdate && payload.groupId) {
      const current = byGroup.get(payload.groupId);
      byGroup.set(payload.groupId, {
        status: current ? worse(current.status, status) : status,
        changes: { ...current?.changes, ...payload.changes },
        splits: payload.splits ?? current?.splits,
        groupTitle: payload.splits ? payload.groupTitle : current?.groupTitle,
      });
    } else if (op.kind === 'attach_receipt' && payload.transactionJournalId != null) {
      const key = String(payload.transactionJournalId);
      const current = byJournal.get(key);
      byJournal.set(key, current ? worse(current, status) : status);
    }
  }
  return { byGroup, byJournal };
}

/** The row's status and its values with the queued changes applied, or null if nothing's queued. */
export function applyPendingEdit<
  T extends {
    groupId: string;
    journalId: string;
    description: string;
    amount: string;
    categoryName: string | null;
  },
>(row: T, edits: PendingEdits): { row: T; status: PendingEditStatus } | null {
  const edit = edits.byGroup.get(row.groupId);
  const upload = edits.byJournal.get(row.journalId);
  if (!edit && !upload) return null;
  const status = edit && upload ? worse(edit.status, upload) : (edit?.status ?? upload!);
  if (!edit) return { row, status };
  const c = edit.changes;
  return {
    status,
    row: {
      ...row,
      description: c.description ?? row.description,
      amount: c.amount ?? row.amount,
      categoryName: 'category_name' in c ? (c.category_name ?? null) : row.categoryName,
    },
  };
}
