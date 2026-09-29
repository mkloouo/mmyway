import { atPlannedTime, readPlannedTime, stripPlannedTime, withPlannedTime } from './plannedTime';

describe('planned time', () => {
  it('lives on its own line in the notes, apart from what the user wrote', () => {
    const notes = withPlannedTime('Family plan', '09:30');
    expect(notes).toBe('Family plan\nmmyway-time: 09:30');
    expect(readPlannedTime(notes)).toBe('09:30');
    expect(stripPlannedTime(notes)).toBe('Family plan');
    expect(withPlannedTime(notes, '18:05')).toBe('Family plan\nmmyway-time: 18:05');
    expect(withPlannedTime(notes, null)).toBe('Family plan');
    expect(readPlannedTime('no marker')).toBeNull();
    expect(readPlannedTime('mmyway-time: 25:00')).toBeNull();
  });

  it('moves the booked day to the planned time', () => {
    const iso = atPlannedTime('2026-10-05T00:00:00+02:00', '09:30')!;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 10, 5, 9, 30,
    ]);
  });
});
