import { relativeTime, describeSyncTime } from './relativeTime';

const now = new Date('2026-09-27T12:00:00.000Z');

describe('relativeTime', () => {
  it('reports never for a missing timestamp', () => {
    expect(relativeTime(null, now)).toBe('never');
    expect(relativeTime(undefined, now)).toBe('never');
  });

  it('reports just now under a minute', () => {
    expect(relativeTime('2026-09-27T11:59:30.000Z', now)).toBe('just now');
  });

  it('reports minutes, hours and days as they cross thresholds', () => {
    expect(relativeTime('2026-09-27T11:58:00.000Z', now)).toBe('2m ago');
    expect(relativeTime('2026-09-27T09:00:00.000Z', now)).toBe('3h ago');
    expect(relativeTime('2026-09-24T12:00:00.000Z', now)).toBe('3d ago');
  });

  it('falls back to a date beyond a week', () => {
    const result = relativeTime('2026-09-01T12:00:00.000Z', now);
    expect(result).not.toMatch(/ago$/);
  });
});

describe('describeSyncTime', () => {
  // 12:00Z is 14:00 in Europe/Warsaw (jest.config pins TZ).
  it('spells out minutes within the hour', () => {
    expect(describeSyncTime(null, now)).toBe('never');
    expect(describeSyncTime('2026-09-27T11:59:30.000Z', now)).toBe('just now');
    expect(describeSyncTime('2026-09-27T11:59:00.000Z', now)).toBe('1 minute ago');
    expect(describeSyncTime('2026-09-27T11:15:00.000Z', now)).toBe('45 minutes ago');
  });

  it('names today and yesterday with the time', () => {
    expect(describeSyncTime('2026-09-27T06:30:00.000Z', now)).toMatch(/^today at .*30/);
    expect(describeSyncTime('2026-09-26T07:10:00.000Z', now)).toMatch(/^yesterday at .*10/);
  });

  it('falls back to a date with the time for anything older', () => {
    const result = describeSyncTime('2026-09-03T12:32:00.000Z', now);
    expect(result).toMatch(/3/);
    expect(result).toMatch(/ at .*32/);
    expect(result).not.toMatch(/2026/);
    expect(describeSyncTime('2025-12-03T12:32:00.000Z', now)).toMatch(/2025/);
  });
});
