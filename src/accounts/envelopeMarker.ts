// The cash-envelope marker lives in the account's FF3 `notes` (design §6.6) as a line
// `mmyway-envelope` — every other line the user wrote is preserved exactly.
const MARKER = 'mmyway-envelope';

export function hasEnvelopeMarker(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return notes.split('\n').some((line) => line.trim() === MARKER);
}

export function setEnvelopeMarker(notes: string | null | undefined, on: boolean): string {
  const original = notes ?? '';
  const lines = original.length > 0 ? original.split('\n') : [];
  const already = lines.some((line) => line.trim() === MARKER);

  if (on) {
    if (already) return original;
    return lines.length > 0 ? `${original}\n${MARKER}` : MARKER;
  }

  if (!already) return original;
  return lines.filter((line) => line.trim() !== MARKER).join('\n');
}
