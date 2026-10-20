import i18n from '../i18n';
import { relativeDayLabel, occurrenceLabel, dayLabel } from './labels';

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
});
