// What a transaction edit really changes. The detail screen records a field as edited the moment a
// picker or keypad reports it, even when the value ends up what it was (the same category picked
// again, the keypad closed, the date dialog confirmed unchanged), and Save queued that as an edit.
// These compare values instead, so a Save that changes nothing just closes. Pure, no db.
import type { TransactionSplit } from '../api/ff3/types';

/**
 * An edit's fields. `null` is a value: it clears the field in FF3 (a category, a budget, a note),
 * where `undefined` is left out of the request and keeps what was there.
 */
export type EditChanges = Omit<
  Partial<TransactionSplit>,
  'category_name' | 'budget_id' | 'notes'
> & {
  category_name?: string | null;
  budget_id?: string | null;
  notes?: string | null;
};

type Changes = EditChanges;

/** "12.50", "12.500000000000" and "012.5" are one amount. */
function amountKey(value: unknown): string {
  const text = String(value ?? '').trim();
  const [whole = '', fraction = ''] = text.split('.');
  const w = whole.replace(/^(-?)0+(?=\d)/, '$1');
  const f = fraction.replace(/0+$/, '');
  return f ? `${w}.${f}` : w;
}

function comparable(key: string, value: unknown): string {
  if (key === 'amount' || key === 'foreign_amount') return amountKey(value);
  if (key === 'date') return value ? String(new Date(String(value)).getTime()) : '';
  if (key === 'tags')
    return JSON.stringify([...((value as string[] | null | undefined) ?? [])].sort());
  // No note, an empty one and a cleared one are the same; likewise any other empty text.
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

/**
 * An empty note can't be sent: FF3 rejects a note of length 0 ("at least 1 character"), while
 * null means "no note" and clears one.
 */
export function sendableNotes(notes: string | null | undefined): string | null {
  return notes && notes.length > 0 ? notes : null;
}

/** The entries of `changes` that differ from `baseline` (what the screen showed before editing). */
export function changedFields(changes: Changes, baseline: Changes): Changes {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    // Undefined is left out of the request body anyway: counted, it queued an edit of nothing.
    if (value === undefined) continue;
    if (comparable(key, value) === comparable(key, (baseline as Record<string, unknown>)[key]))
      continue;
    out[key] = key === 'notes' ? sendableNotes(value as string | null | undefined) : value;
  }
  return out as Changes;
}

/**
 * Whether two lists of queued splits (toPayloadSplits' output) say the same thing: same order, and
 * per split the same fields by value.
 */
export function sameSplits(a: readonly object[], b: readonly object[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((split, i) => {
    const other = b[i]!;
    const keys = new Set([...Object.keys(split), ...Object.keys(other)]);
    return [...keys].every(
      (k) =>
        comparable(k, (split as Record<string, unknown>)[k]) ===
        comparable(k, (other as Record<string, unknown>)[k]),
    );
  });
}

export function sameAmount(a: string, b: string): boolean {
  return amountKey(a) === amountKey(b);
}
