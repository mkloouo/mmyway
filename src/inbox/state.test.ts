import { returnedState, transition } from './state';

describe('inbox state machine', () => {
  it('lets a manual entry go straight from captured to confirmed', () => {
    expect(transition('captured', 'confirm')).toBe('confirmed');
  });
  it('requires a receipt to pass through parsed before confirming', () => {
    expect(transition('captured', 'parsed')).toBe('parsed');
    expect(transition('parsed', 'confirm')).toBe('confirmed');
  });
  it('rejects confirming an already-synced item', () => {
    expect(() => transition('synced', 'confirm')).toThrow();
  });
  it('hands a queued create back as a draft, and a receipt back as already read', () => {
    expect(returnedState('manual_entry')).toBe('captured');
    expect(returnedState('receipt')).toBe('parsed');
  });
  it('only lets a confirmed item be returned', () => {
    expect(() => transition('synced', 'return')).toThrow();
    expect(() => transition('parsed', 'return')).toThrow();
  });
  it('allows retrying an errored item back to captured', () => {
    expect(transition('error', 'retry')).toBe('captured');
  });
});
