// A planned transaction's time of day. FF3's recurring transactions have dates only, so the app
// keeps the time as a marker, `[mmyway time=09:30]`, in the description of the planned
// transaction's rule, and applies it when the booked transaction is approved in the Inbox. Pure.
//
// Why the rule: FF3 offers a recurrence no hidden field for it (no internal reference, and its meta
// table isn't writable through the API), and its notes were no good either. They hold the user's
// note, and the recurrence *update* strips their newlines (its UpdateRequest reads them with
// convertString, which deletes \r and \n), which glued the old marker line onto the user's text
// ("Rent till ownmmyway-time: 09:00"). A rule's description keeps newlines, can be cleared, and
// shows in the rule's edit form, where the user can see what the app keeps there.
//
// The marker's brackets make it findable anywhere in a text. Times kept in a recurrence's notes by
// earlier versions, as the old line or in brackets, are still read, and the next save moves them.
const MARKER = /\[mmyway\s+time=(\d{1,2}):(\d{2})\]/;
const LEGACY_MARKER = /mmyway-time:\s*(\d{1,2}):(\d{2})/;
const ANY_MARKER = new RegExp(`${MARKER.source}|${LEGACY_MARKER.source}`, 'g');

/** "HH:MM" from notes carrying the marker, or null. */
export function readPlannedTime(notes: string | null | undefined): string | null {
  const match = MARKER.exec(notes ?? '') ?? LEGACY_MARKER.exec(notes ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

/** A text without any marker, old or new: what the user wrote. */
export function stripPlannedTime(notes: string | null | undefined): string | null {
  const rest = (notes ?? '')
    .replace(ANY_MARKER, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, i, lines) => line !== '' || (i > 0 && i < lines.length - 1))
    .join('\n')
    .trim();
  return rest || null;
}

/** The user's text with the marker for `time` after it (or without one, for no time). */
export function withPlannedTime(notes: string | null | undefined, time: string | null): string {
  const own = stripPlannedTime(notes);
  const marker = time ? `[mmyway time=${time}]` : null;
  return [own, marker].filter(Boolean).join(' ');
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
