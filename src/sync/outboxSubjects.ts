// What a queued operation touches, so the replay can hold back only the operations that depend on
// one that failed (#41). Two operations depend on each other when they share a subject: the same
// transaction group or journal, Inbox entry, account, or planned transaction. Pure, no db.
import { OUTBOX_KINDS } from './outboxKinds';
import type { OutboxKind } from './outboxTypes';
import { readPayload } from './payloadJson';

/** Subject keys of one operation; null when its payload can't be read, which blocks everything after it. */
export function subjectsOf(op: {
  kind: OutboxKind;
  payloadJson: string;
  inboxItemId: string | null;
}): string[] | null {
  let p: unknown;
  try {
    p = readPayload(op.kind, op.payloadJson);
  } catch {
    return null;
  }
  const spec = (OUTBOX_KINDS as Record<string, (typeof OUTBOX_KINDS)[keyof typeof OUTBOX_KINDS]>)[
    op.kind
  ];
  if (!spec) return null;
  const keys: string[] = [];
  const add = (prefix: string, value: unknown) => {
    if (typeof value === 'string' && value) keys.push(`${prefix}:${value}`);
    else if (typeof value === 'number') keys.push(`${prefix}:${value}`);
  };
  add('inbox', op.inboxItemId);
  spec.subjects(p, add);
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
