import { inPeriod, periodOf, previousPeriod } from './period';

describe('periodOf', () => {
  it('spans the whole calendar month', () => {
    expect(periodOf('2026-10-11')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(periodOf('2026-11-30')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
  });
  it('gets February right in a leap year and out of one', () => {
    expect(periodOf('2024-02-05').end).toBe('2024-02-29');
    expect(periodOf('2026-02-05').end).toBe('2026-02-28');
  });
  it('takes a full ISO day as the day it starts with', () => {
    expect(periodOf('2026-01-01')).toEqual({ start: '2026-01-01', end: '2026-01-31' });
  });
});

describe('previousPeriod', () => {
  it('steps back one month', () => {
    expect(previousPeriod(periodOf('2026-10-11'))).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
    });
  });
  it('crosses the year boundary', () => {
    expect(previousPeriod(periodOf('2026-01-20'))).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
    });
  });
});

describe('inPeriod', () => {
  const october = periodOf('2026-10-11');
  it('includes both ends and ignores a timestamp', () => {
    expect(inPeriod(october, '2026-10-01')).toBe(true);
    expect(inPeriod(october, '2026-10-31T23:59:59+02:00')).toBe(true);
    expect(inPeriod(october, '2026-11-01')).toBe(false);
    expect(inPeriod(october, '2026-09-30')).toBe(false);
    expect(inPeriod(october, null)).toBe(false);
  });
});
