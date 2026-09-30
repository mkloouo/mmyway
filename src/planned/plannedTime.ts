// A planned transaction's time of day. FF3's recurring transactions have dates only, so the app
// keeps the time as a marker (`mmyway-time: 09:30`) alone in the recurrence's notes, and applies
// it when the booked transaction is approved in the Inbox. Pure.
//
// The marker is found anywhere in a text: earlier versions kept the user's note there too, with the
// time on a line of its own, and FF3's recurrence update strips newlines, gluing the two together
// ("Rent till ownmmyway-time: 09:00").

const MARKER = /mmyway-time:\s*(\d{1,2}):(\d{2})/;

/** "HH:MM" from notes carrying the marker, or null. */
export function readPlannedTime(notes: string | null | undefined): string | null {
  const match = MARKER.exec(notes ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

/** The notes without the marker: what the user wrote. */
export function stripPlannedTime(notes: string | null | undefined): string | null {
  return (notes ?? '').replace(new RegExp(MARKER, 'g'), '').trim() || null;
}

/** The recurrence's notes for `time`: the marker, or null (which clears them) for any time. */
export function plannedTimeNote(time: string | null): string | null {
  return time ? `mmyway-time: ${time}` : null;
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
