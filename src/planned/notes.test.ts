import {
  atPlannedTime,
  readMarkers,
  readPlannedTime,
  stripMarkers,
  toggleSkipDay,
  writeMarkers,
} from './notes';

describe('recurrence note markers', () => {
  it('keeps both markers on one line and round-trips them', () => {
    const notes = writeMarkers({ time: '09:30', skip: ['2026-12-01', '2026-11-01'] })!;
    expect(notes).toBe('mmyway-time: 09:30 mmyway-skip: 2026-11-01,2026-12-01');
    expect(notes).not.toContain('\n');
    expect(readMarkers(notes)).toEqual({ time: '09:30', skip: ['2026-11-01', '2026-12-01'] });
    expect(stripMarkers(notes)).toBeNull();
  });

  it('is null when nothing is marked', () => {
    expect(writeMarkers({ time: null, skip: [] })).toBeNull();
    expect(readMarkers(null)).toEqual({ time: null, skip: [] });
    expect(readMarkers('no marker')).toEqual({ time: null, skip: [] });
  });

  it('reads a marker wherever it sits in a text', () => {
    // What an earlier version's note and time became after FF3's recurrence update.
    const glued = 'Rent\n\ntill ownmmyway-time: 09:00';
    expect(readPlannedTime(glued)).toBe('09:00');
    expect(stripMarkers(glued)).toBe('Rent\n\ntill own');
    expect(readPlannedTime('mmyway-time: 25:00')).toBeNull();
  });

  it('leaves a marker it does not know alone', () => {
    const notes = writeMarkers({ time: '08:00', skip: [] }, 'mmyway-future: 7 kept text')!;
    expect(notes).toBe('mmyway-time: 08:00 mmyway-future: 7 kept text');
    expect(stripMarkers(notes)).toBe('mmyway-future: 7 kept text');
  });

  it('ignores a skipped date that is not a date', () => {
    expect(readMarkers('mmyway-skip: 2026-11-01,,99').skip).toEqual(['2026-11-01']);
  });

  it('toggles a skipped date and forgets the past ones', () => {
    const today = '2026-10-11';
    expect(toggleSkipDay(['2026-01-01'], '2026-11-01', today)).toEqual(['2026-11-01']);
    expect(toggleSkipDay(['2026-11-01', '2026-12-01'], '2026-11-01', today)).toEqual([
      '2026-12-01',
    ]);
  });

  it('moves the booked day to the planned time', () => {
    const iso = atPlannedTime('2026-10-05T00:00:00+02:00', '09:30')!;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 10, 5, 9, 30,
    ]);
  });
});
