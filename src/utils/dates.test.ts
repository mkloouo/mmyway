import {
  dateTime,
  fullDay,
  monthDay,
  monthYear,
  shortDay,
  weekdayDay,
  weekdayName,
  weekdayOf,
} from './dates';

describe('src/utils/dates', () => {
  it('formats shortDay from Date or string', () => {
    expect(shortDay('2026-03-05')).toMatch(/Mar|3|5/);
    expect(shortDay(new Date('2026-03-05T12:00:00'))).toMatch(/Mar|3|5/);
    expect(shortDay('invalid')).toBe('invalid');
  });

  it('formats fullDay with year', () => {
    expect(fullDay('2026-03-05')).toMatch(/2026/);
    expect(fullDay(new Date('2026-03-05T12:00:00'))).toMatch(/2026/);
  });

  it('formats weekdayDay with short weekday', () => {
    expect(weekdayDay('2026-03-05')).toBeTruthy();
  });

  it('formats monthDay and monthYear', () => {
    expect(monthDay('2026-03-05')).toMatch(/March|5/);
    expect(monthYear('2026-03-05')).toMatch(/March.*2026|2026.*March/);
  });

  it('formats weekdayName from ISO 1..7', () => {
    expect(weekdayName(1)).toBe('Monday');
    expect(weekdayName(1, 'short')).toBe('Mon');
    expect(weekdayName(7)).toBe('Sunday');
  });

  it('formats weekdayOf a date', () => {
    expect(weekdayOf('2026-03-05')).toBe('Thursday');
  });

  it('formats dateTime with time parts', () => {
    expect(dateTime('2026-03-05T14:30:00')).toMatch(/2:30/);
  });
});
