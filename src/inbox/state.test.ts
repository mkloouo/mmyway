import { transition } from './state';

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
  it('allows retrying an errored item back to captured', () => {
    expect(transition('error', 'retry')).toBe('captured');
  });
});
