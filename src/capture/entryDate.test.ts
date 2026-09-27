import { buildEntryDate, yesterday } from './entryDate';

process.env.TZ = 'Europe/Warsaw';

describe('buildEntryDate', () => {
  it('keeps its calendar day after toISOString() in Europe/Warsaw (regression: brief-noted backdating bug)', () => {
    const picked = new Date(2026, 5, 15); // June 15 2026, local midnight — CEST, UTC+2
    const clock = new Date(2026, 5, 15, 14, 32, 0); // 14:32 local
    const result = buildEntryDate(picked, clock);
    expect(result.toISOString().slice(0, 10)).toBe('2026-06-15');
  });

  it('a naive local-midnight Date would have crossed into the previous UTC day (what this fixes)', () => {
    const midnightOnly = new Date(2026, 5, 15);
    expect(midnightOnly.toISOString().slice(0, 10)).not.toBe('2026-06-15');
  });

  it('takes the picked day but the clock time, not midnight', () => {
    const picked = new Date(2026, 8, 1); // Sep 1, any time
    const clock = new Date(2026, 8, 27, 9, 5, 30);
    const result = buildEntryDate(picked, clock);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(8);
    expect(result.getDate()).toBe(1);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(5);
    expect(result.getSeconds()).toBe(30);
  });
});

describe('yesterday', () => {
  it('subtracts one calendar day, keeping the clock time', () => {
    const now = new Date(2026, 8, 27, 14, 2, 0);
    const result = yesterday(now);
    expect(result.getDate()).toBe(26);
    expect(result.getHours()).toBe(14);
  });

  it('rolls across a month boundary', () => {
    const now = new Date(2026, 8, 1, 8, 0, 0); // Sep 1
    const result = yesterday(now);
    expect(result.getMonth()).toBe(7); // Aug
    expect(result.getDate()).toBe(31);
  });
});
