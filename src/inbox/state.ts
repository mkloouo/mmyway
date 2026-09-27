export type InboxState = 'captured' | 'parsed' | 'confirmed' | 'synced' | 'error';
export type InboxEvent = 'parsed' | 'confirm' | 'synced' | 'fail' | 'retry';

const TRANSITIONS: Record<InboxState, Partial<Record<InboxEvent, InboxState>>> = {
  captured: { parsed: 'parsed', confirm: 'confirmed', fail: 'error' }, // manual entries can confirm directly (no parse step)
  parsed: { confirm: 'confirmed', fail: 'error' },
  confirmed: { synced: 'synced', fail: 'error' },
  synced: {},
  error: { retry: 'captured' },
};

export function transition(current: InboxState, event: InboxEvent): InboxState {
  const next = TRANSITIONS[current][event];
  if (!next) throw new Error(`invalid transition: ${current} + ${event}`);
  return next;
}
