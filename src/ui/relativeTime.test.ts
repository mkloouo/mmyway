import { relativeTime } from './relativeTime';

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
