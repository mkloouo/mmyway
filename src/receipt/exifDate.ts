// When a photo was taken, from its EXIF (expo-image-picker's `exif: true`). A receipt without a
// printed date is dated by it (src/receipt/toDraft.ts's receiptDate). Pure.

// "2026:09:30 14:05:12" — EXIF's own format, wall-clock time where the photo was taken.
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET = /^[+-]\d{2}:\d{2}$/;

/**
 * The ISO time the photo was taken, or undefined when the EXIF has none worth trusting (missing,
 * the "0000:00:00 00:00:00" some cameras write, or unparseable). With OffsetTimeOriginal the
 * instant is exact; without it the time is read as the phone's own zone.
 */
export function exifTakenAt(exif: Record<string, unknown> | null | undefined): string | undefined {
  const raw = exif?.DateTimeOriginal ?? exif?.DateTime;
  const match = typeof raw === 'string' ? EXIF_DATE.exec(raw.trim()) : null;
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match.map(Number) as number[];
  if (y! < 2000 || mo! < 1 || mo! > 12 || d! < 1 || d! > 31) return undefined;
  const offset = exif?.OffsetTimeOriginal ?? exif?.OffsetTime;
  const date =
    typeof offset === 'string' && OFFSET.test(offset.trim())
      ? new Date(
          `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${offset.trim()}`,
        )
      : new Date(y!, mo! - 1, d!, h!, mi!, s!);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
