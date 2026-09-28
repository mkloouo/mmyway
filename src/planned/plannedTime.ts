// A planned transaction's time of day. FF3's recurring transactions have dates only, so the app
// keeps the time as a marker line in the recurrence's notes (`mmyway-time: 09:30`, like the
// accounts' `mmyway-envelope` line) and applies it when the booked transaction is approved in
// the Inbox. Pure.

const MARKER = /^mmyway-time:\s*(\d{1,2}):(\d{2})\s*$/m;

/** "HH:MM" from notes carrying the marker, or null. */
export function readPlannedTime(notes: string | null | undefined): string | null {
  const match = MARKER.exec(notes ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

/** The notes without the marker line: what the user wrote. */
export function stripPlannedTime(notes: string | null | undefined): string | null {
  const rest = (notes ?? '')
    .split('\n')
    .filter((line) => !MARKER.test(line))
    .join('\n')
    .trim();
  return rest || null;
}

/** The user's notes with the marker line for `time` (or without one, for no time). */
export function withPlannedTime(notes: string | null | undefined, time: string | null): string {
  const own = stripPlannedTime(notes);
  const marker = time ? `mmyway-time: ${time}` : null;
  return [own, marker].filter(Boolean).join('\n');
}

/**
 * The booked transaction's date at the planned time, in the phone's time zone: the day FF3
 * booked it on (YYYY-MM-DD from its date) and the planned hour and minute.
 */
export function atPlannedTime(bookedDate: string, time: string): string | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(bookedDate);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return null;
  return new Date(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(clock[1]),
    Number(clock[2]),
  ).toISOString();
}
