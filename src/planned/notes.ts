// The markers the app keeps in a recurring transaction's notes, and nothing else. Pure.
//
// FF3's recurrences have no time of day and no per-occurrence skip, so the app keeps both
// server-side, in the recurrence's own notes: they survive a reinstall and are readable in FF3's
// web UI. The user's own note is kept on the *subscription* instead, because a recurrence update
// maps notes through `convertString` → `clearString`, which strips every newline
// (`ConvertsDataTypes.php`), where a bill update maps them through `stringWithNewlines`.
//
// Everything therefore shares **one line**, which is why each marker is found anywhere in the text
// rather than at a fixed position. An omitted `notes` key leaves FF3's stored note alone and `''`
// clears it (`RecurrenceUpdateService::update`), so the markers are always written together.
//
// A marker this build does not know is left where it is: a newer build's marker must survive an
// older one reading and rewriting the notes.

const TIME = /mmyway-time:\s*(\d{1,2}):(\d{2})/;
const SKIP = /mmyway-skip:\s*([\d,-]+)/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

interface PlannedMarkers {
  /** "HH:MM" the planned transaction is meant for, or null for any time. */
  time: string | null;
  /** Occurrences the user cancelled one by one, as YYYY-MM-DD, sorted. */
  skip: string[];
}

const dedupe = (days: readonly string[]): string[] =>
  [...new Set(days.filter((d) => DAY.test(d)))].sort();

/** Every marker this build knows, read out of a recurrence's notes. */
export function readMarkers(notes: string | null | undefined): PlannedMarkers {
  const text = notes ?? '';
  const time = TIME.exec(text);
  const hours = time ? Number(time[1]) : 0;
  const minutes = time ? Number(time[2]) : 0;
  const skip = SKIP.exec(text);
  return {
    time:
      time && hours <= 23 && minutes <= 59 ? `${String(hours).padStart(2, '0')}:${time[2]}` : null,
    skip: skip?.[1] ? dedupe(skip[1].split(',')) : [],
  };
}

/** "HH:MM" from notes carrying the time marker, or null. */
export const readPlannedTime = (notes: string | null | undefined): string | null =>
  readMarkers(notes).time;

/** The notes without the markers this build knows: what is left of the text around them. */
export function stripMarkers(notes: string | null | undefined): string | null {
  return (
    (notes ?? '')
      .replace(new RegExp(TIME, 'g'), '')
      .replace(new RegExp(SKIP, 'g'), '')
      // Runs of spaces a removed marker left behind; newlines are kept (a bill's note has them).
      .replace(/[ \t]{2,}/g, ' ')
      .trim() || null
  );
}

/**
 * The notes to send for a set of markers, on one line: the markers themselves, plus whatever else
 * was in the notes (a marker a newer build wrote, or a note made in FF3's web UI). Null when there
 * is nothing left to keep — which clears the field.
 */
export function writeMarkers(markers: PlannedMarkers, existing?: string | null): string | null {
  const skip = dedupe(markers.skip);
  return (
    [
      markers.time ? `mmyway-time: ${markers.time}` : null,
      skip.length ? `mmyway-skip: ${skip.join(',')}` : null,
      stripMarkers(existing),
    ]
      .filter(Boolean)
      .join(' ') || null
  );
}

/**
 * `days` with `day` skipped, or un-skipped when it already is. Dates before `today` are dropped:
 * they have been handled, and the marker would otherwise grow for as long as the recurrence lives.
 */
export function toggleSkipDay(days: readonly string[], day: string, today: string): string[] {
  const kept = days.filter((d) => DAY.test(d) && d >= today && d !== day);
  return dedupe(days.includes(day) ? kept : [...kept, day]);
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
