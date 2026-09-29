import { dayDate, isBalanceStale, localDay } from './day';

describe('localDay', () => {
  it('formats a local date, not the UTC one', () => {
    // 23:30 local on the 5th is the 6th in UTC anywhere east of Greenwich.
    expect(localDay(new Date(2026, 8, 5, 23, 30))).toBe('2026-09-05');
  });

  it('pads the month and the day', () => {
    expect(localDay(new Date(2026, 0, 2))).toBe('2026-01-02');
  });

  it('round-trips through dayDate', () => {
    expect(localDay(dayDate('2026-01-02'))).toBe('2026-01-02');
  });
});

describe('isBalanceStale', () => {
  const now = new Date(2026, 8, 5, 12, 0).getTime();

  it('counts a missing read date as stale', () => {
    expect(isBalanceStale(null, now)).toBe(true);
  });

  it('is false an hour ago and true two days ago', () => {
    expect(isBalanceStale(new Date(now - 60 * 60 * 1000).toISOString(), now)).toBe(false);
    expect(isBalanceStale(new Date(now - 48 * 60 * 60 * 1000).toISOString(), now)).toBe(true);
  });
});
