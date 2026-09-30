// What a receipt reader filled in without being sure of it (`lowConfidenceFields`, set only by
// src/receipt/toDraft.ts), for the draft screen to mark until the user has looked at it. Pure.
import type { Draft } from './draft';

type UnsureField = 'amount' | 'payee' | 'date';

const UNSURE: readonly UnsureField[] = ['amount', 'payee', 'date'];

/** The fields still to check, in a fixed order; unknown names from an older reader are skipped. */
export function unsureFields(draft: Pick<Draft, 'lowConfidenceFields'>): UnsureField[] {
  const listed = new Set(draft.lowConfidenceFields ?? []);
  return UNSURE.filter((f) => listed.has(f));
}

/**
 * The list after `patch` is written: a field the user set is theirs now and no longer marked.
 * undefined once nothing is left, so the draft carries no empty list.
 */
export function unsureAfter(draft: Draft, patch: Partial<Draft>): string[] | undefined {
  if (!draft.lowConfidenceFields) return undefined;
  const type = patch.type ?? draft.type;
  const touched = new Set<string>();
  if ('amount' in patch) touched.add('amount');
  if ('date' in patch) touched.add('date');
  // Which end is the payee follows the type: an expense's destination, an income's source.
  if (type === 'withdrawal' && 'destinationName' in patch) touched.add('payee');
  if (type === 'deposit' && 'sourceName' in patch) touched.add('payee');
  const left = draft.lowConfidenceFields.filter((f) => !touched.has(f));
  return left.length > 0 ? left : undefined;
}
