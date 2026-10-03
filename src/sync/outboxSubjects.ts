// What a queued operation touches, so the replay can hold back only the operations that depend on
// one that failed (#41). Two operations depend on each other when they share a subject: the same
// transaction group or journal, Inbox entry, account, or planned transaction. Pure, no db.
import type { OutboxKind } from './outbox';
import { readPayload } from './payloadJson';

/** Subject keys of one operation; null when its payload can't be read, which blocks everything after it. */
export function subjectsOf(op: {
  kind: OutboxKind;
  payloadJson: string;
  inboxItemId: string | null;
}): string[] | null {
  let p: Record<string, unknown>;
  try {
    p = readPayload(op.kind, op.payloadJson);
  } catch {
    return null;
  }
  const keys: string[] = [];
  const add = (prefix: string, value: unknown) => {
    if (typeof value === 'string' && value) keys.push(`${prefix}:${value}`);
    else if (typeof value === 'number') keys.push(`${prefix}:${value}`);
  };
  // A transaction also depends on the accounts it books to: an account edit queued before it
  // (making it active again, say) has to land first.
  const addAccounts = (splits: unknown) => {
    for (const s of (Array.isArray(splits) ? splits : []) as Record<string, unknown>[]) {
      add('account', s.source_id);
      add('account', s.destination_id);
    }
  };
  add('inbox', op.inboxItemId);
  switch (op.kind) {
    case 'create_transaction':
      addAccounts(p.splits);
      break;
    case 'update_transaction':
    case 'recurring_review':
      add('group', p.groupId);
      add('journal', p.transactionJournalId);
      addAccounts([p.changes, ...(Array.isArray(p.splits) ? p.splits : [])]);
      break;
    case 'delete_transaction':
      add('group', p.groupId);
      break;
    case 'attach_receipt':
      add('journal', p.transactionJournalId);
      break;
    case 'update_account':
      add('account', p.accountId);
      break;
    case 'reorder_accounts':
      for (const id of p.orderedIds as string[]) add('account', id);
      break;
    case 'save_planned':
    case 'delete_planned':
      add('planned', p.key);
      add('bill', p.billId);
      add('rule', p.ruleId);
      add('recurrence', p.recurrenceId);
      break;
  }
  return keys;
}

/**
 * Tracks what a replay must not send yet: the subjects of every operation that failed, or waits
 * behind one that did. An operation sharing any of them waits too, and passes its own subjects on,
 * so a chain of dependent changes keeps its order.
 */
export class OutboxBlocker {
  private readonly blocked = new Set<string>();
  private all = false;

  /** Whether `subjects` must wait; null subjects (an unreadable payload) wait behind anything blocked. */
  waits(subjects: string[] | null): boolean {
    if (this.all) return true;
    if (subjects === null) return this.blocked.size > 0;
    return subjects.some((k) => this.blocked.has(k));
  }

  /** Holds back everything sharing `subjects` from here on; null holds back everything. */
  block(subjects: string[] | null): void {
    if (subjects === null) this.all = true;
    else for (const k of subjects) this.blocked.add(k);
  }

  get blocksEverything(): boolean {
    return this.all;
  }
}
