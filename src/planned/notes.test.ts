import { atPlannedTime, plannedTimeNote, readPlannedTime, stripPlannedTime } from './plannedTime';

describe('planned time', () => {
  it('is kept as a marker, read wherever it is in a text', () => {
    expect(plannedTimeNote('09:30')).toBe('mmyway-time: 09:30');
    expect(plannedTimeNote(null)).toBeNull();
    expect(readPlannedTime('mmyway-time: 09:30')).toBe('09:30');
    // What an earlier version's note and time became after FF3's recurrence update.
    const glued = 'Rent\n\ntill ownmmyway-time: 09:00';
    expect(readPlannedTime(glued)).toBe('09:00');
    expect(stripPlannedTime(glued)).toBe('Rent\n\ntill own');
    expect(stripPlannedTime('mmyway-time: 09:00')).toBeNull();
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
