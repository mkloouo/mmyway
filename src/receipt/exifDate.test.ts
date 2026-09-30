import { exifTakenAt } from './exifDate';

// jest.config.js pins TZ=Europe/Warsaw (UTC+2 in September).
describe('exifTakenAt', () => {
  it("reads DateTimeOriginal as the phone's local time", () => {
    expect(exifTakenAt({ DateTimeOriginal: '2026:09:30 14:05:12' })).toBe(
      '2026-09-30T12:05:12.000Z',
    );
  });

  it('uses the recorded offset when the photo has one', () => {
    expect(
      exifTakenAt({ DateTimeOriginal: '2026:09:30 14:05:12', OffsetTimeOriginal: '+05:00' }),
    ).toBe('2026-09-30T09:05:12.000Z');
  });

  it('falls back to DateTime when DateTimeOriginal is missing', () => {
    expect(exifTakenAt({ DateTime: '2026:09:30 08:00:00' })).toBe('2026-09-30T06:00:00.000Z');
  });

  it('ignores missing, zeroed and unparseable dates', () => {
    expect(exifTakenAt(undefined)).toBeUndefined();
    expect(exifTakenAt({})).toBeUndefined();
    expect(exifTakenAt({ DateTimeOriginal: '0000:00:00 00:00:00' })).toBeUndefined();
    expect(exifTakenAt({ DateTimeOriginal: 'yesterday' })).toBeUndefined();
    expect(exifTakenAt({ DateTimeOriginal: 20260930 })).toBeUndefined();
  });
});
