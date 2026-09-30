import { atPlannedTime, readPlannedTime, stripPlannedTime, withPlannedTime } from './plannedTime';

describe('planned time', () => {
  it('keeps the time in a bracketed marker after what the user wrote', () => {
    const notes = withPlannedTime('Family plan', '09:30');
    expect(notes).toBe('Family plan [mmyway time=09:30]');
    expect(readPlannedTime(notes)).toBe('09:30');
    expect(stripPlannedTime(notes)).toBe('Family plan');
    expect(withPlannedTime(notes, '18:05')).toBe('Family plan [mmyway time=18:05]');
    expect(withPlannedTime(notes, null)).toBe('Family plan');
    expect(withPlannedTime(null, '07:00')).toBe('[mmyway time=07:00]');
    expect(readPlannedTime('no marker')).toBeNull();
    expect(readPlannedTime('[mmyway time=25:00]')).toBeNull();
  });

  it("survives FF3's recurrence update removing newlines", () => {
    // What FF3 stores after an update: every newline deleted, nothing put in its place.
    const flattened = withPlannedTime('Line one\nline two', '09:30').replace(/\n/g, '');
    expect(readPlannedTime(flattened)).toBe('09:30');
    expect(stripPlannedTime(flattened)).toBe('Line oneline two');
  });

  it('still reads the old marker line, even glued onto the text by such an update', () => {
    expect(readPlannedTime('Family plan\nmmyway-time: 09:30')).toBe('09:30');
    expect(stripPlannedTime('Family plan\nmmyway-time: 09:30')).toBe('Family plan');
    const glued = 'Rent till ownmmyway-time: 09:00';
    expect(readPlannedTime(glued)).toBe('09:00');
    expect(stripPlannedTime(glued)).toBe('Rent till own');
    // The next save writes the new form.
    expect(withPlannedTime(glued, '09:00')).toBe('Rent till own [mmyway time=09:00]');
  });

  it("keeps the user's own blank lines inside their notes", () => {
    expect(stripPlannedTime('First\n\nSecond [mmyway time=09:30]')).toBe('First\n\nSecond');
  });

  it('moves the booked day to the planned time', () => {
    const iso = atPlannedTime('2026-10-05T00:00:00+02:00', '09:30')!;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 10, 5, 9, 30,
    ]);
  });
});
