import i18n from '../i18n';
import {
  relativeDayLabel,
  occurrenceLabel,
  dayLabel,
  scheduleSince,
  nextOccurrence,
} from './labels';

describe('labels', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  describe('relativeDayLabel', () => {
    const today = '2026-10-12';

    it('formats today', () => {
      expect(relativeDayLabel('2026-10-12', today)).toBe('today');
    });

    it('formats tomorrow', () => {
      expect(relativeDayLabel('2026-10-13', today)).toBe('tomorrow');
    });

    it('formats in 3 days', () => {
      expect(relativeDayLabel('2026-10-15', today)).toBe('in 3 days');
    });

    it('formats in 2 months', () => {
      expect(relativeDayLabel('2026-12-15', today)).toBe('in 2 months');
    });

    it('formats yesterday', () => {
      expect(relativeDayLabel('2026-10-11', today)).toBe('yesterday');
    });

    it('formats past days', () => {
      expect(relativeDayLabel('2026-10-09', today)).toBe('3d ago');
    });

    it('returns empty string for invalid date', () => {
      expect(relativeDayLabel('not-a-date', today)).toBe('');
    });
  });

  describe('occurrenceLabel', () => {
    it('formats weekday and date in short form', () => {
      // 2026-10-15 is a Thursday
      expect(occurrenceLabel('2026-10-15')).toContain('Thu');
      expect(occurrenceLabel('2026-10-15')).toContain('15');
    });
  });

  describe('dayLabel', () => {
    it('formats full day with year', () => {
      expect(dayLabel('2026-10-15')).toContain('2026');
      expect(dayLabel('2026-10-15')).toContain('15');
    });
  });

  describe('scheduleSince', () => {
    it('returns empty string when not repeating', () => {
      expect(
        scheduleSince({
          repeats: false,
          date: '2026-01-15',
          end: { kind: 'forever' },
          repetitions: [],
        }),
      ).toBe('');
    });

    it('formats since date, no end, and weekend rule', () => {
      const result = scheduleSince({
        repeats: true,
        date: '2026-01-15',
        end: { kind: 'forever' },
        repetitions: [{ type: 'monthly', moment: '15', skip: 0, weekend: 3 }],
      });
      expect(result).toContain('Since');
      expect(result).toContain('15');
      expect(result).toContain('no end');
      expect(result).toContain('weekends move to Friday');
    });

    it('formats until date if end kind is until', () => {
      const result = scheduleSince({
        repeats: true,
        date: '2026-01-15',
        end: { kind: 'until', date: '2026-12-31' },
        repetitions: [{ type: 'monthly', moment: '15', skip: 0, weekend: 1 }],
      });
      expect(result).toContain('Since');
      expect(result).toContain('until');
    });
  });

  describe('nextOccurrence', () => {
    const today = '2026-10-12';

    it('returns planned date if not repeating and date is today or future', () => {
      expect(
        nextOccurrence(
          {
            repeats: false,
            date: '2026-10-15',
            repetitions: [],
            end: { kind: 'forever' },
            skipDays: [],
          },
          today,
        ),
      ).toBe('2026-10-15');
    });

    it('returns null if not repeating and date is in the past', () => {
      expect(
        nextOccurrence(
          {
            repeats: false,
            date: '2026-10-10',
            repetitions: [],
            end: { kind: 'forever' },
            skipDays: [],
          },
          today,
        ),
      ).toBeNull();
    });

    it('returns next upcoming occurrence for repeating item', () => {
      expect(
        nextOccurrence(
          {
            repeats: true,
            date: '2026-01-15',
            repetitions: [{ type: 'monthly', moment: '15', skip: 0, weekend: 1 }],
            end: { kind: 'forever' },
            skipDays: [],
          },
          today,
        ),
      ).toBe('2026-10-15');
    });

    it('skips dates in skipDays', () => {
      expect(
        nextOccurrence(
          {
            repeats: true,
            date: '2026-01-15',
            repetitions: [{ type: 'monthly', moment: '15', skip: 0, weekend: 1 }],
            end: { kind: 'forever' },
            skipDays: ['2026-10-15'],
          },
          today,
        ),
      ).toBe('2026-11-15');
    });
  });
});
