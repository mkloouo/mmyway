export type InboxState = 'captured' | 'parsed' | 'confirmed' | 'synced' | 'error';
type InboxEvent = 'parsed' | 'confirm' | 'synced' | 'fail' | 'retry' | 'return' | 'return_reviewed';

const TRANSITIONS: Record<InboxState, Partial<Record<InboxEvent, InboxState>>> = {
  captured: { parsed: 'parsed', confirm: 'confirmed', fail: 'error' }, // manual entries can confirm directly (no parse step)
  parsed: { confirm: 'confirmed', fail: 'error' },
  // `return`: a queued create that never left (cancelled, undone, or refused because a reference is
  // gone) is handed back as a draft. A receipt goes back `parsed`, already read: as `captured` the
  // next sync would read the photo again and overwrite the draft.
  confirmed: { synced: 'synced', fail: 'error', return: 'captured', return_reviewed: 'parsed' },
  synced: {},
  error: { retry: 'captured' },
};

export function transition(current: InboxState, event: InboxEvent): InboxState {
  const next = TRANSITIONS[current][event];
  if (!next) throw new Error(`invalid transition: ${current} + ${event}`);
  return next;
}

/** The state an item goes back to when its queued create is taken back out of the outbox. */
export function returnedState(kind: 'manual_entry' | 'receipt' | 'recurring_review'): InboxState {
  return transition('confirmed', kind === 'receipt' ? 'return_reviewed' : 'return');
}
