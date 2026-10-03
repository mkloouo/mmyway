// Changing a synced transaction's kind (Activity → a transaction → Kind). Firefly III stores no
// direction of its own: the kind *is* which sort of account sits at each end. An expense leaves
// one of your accounts for an expense account (the payee), an income arrives from a revenue
// account (the payer) into one of yours, and a transfer runs between two of your own. So changing
// the kind means rewiring both ends, and rewiring them the wrong way round books the money
// backwards — which is why this is a pure function with its own tests, not a branch in a screen.
import type { EditChanges } from './editDiff';

type TxType = 'withdrawal' | 'deposit' | 'transfer';
type End = 'source' | 'destination';

export interface TxEnds {
  /** One of the user's own accounts, when this end holds one. */
  sourceId: string | null;
  /** The payer's name, when this end is the payer. */
  sourceName: string | null;
  destinationId: string | null;
  /** The payee's name, when this end is the payee. */
  destinationName: string | null;
}

/** The ends holding one of the user's own accounts. A transfer holds one at both. */
function ownEnds(type: TxType): End[] {
  if (type === 'withdrawal') return ['source'];
  if (type === 'deposit') return ['destination'];
  return ['source', 'destination'];
}

/** The end holding the payee or the payer; a transfer has neither. */
function partyEnd(type: TxType): End | null {
  if (type === 'withdrawal') return 'destination';
  if (type === 'deposit') return 'source';
  return null;
}

function idAt(ends: TxEnds, end: End): string | null {
  return end === 'source' ? ends.sourceId : ends.destinationId;
}

/**
 * The ends as `to` needs them, given how `from` left them:
 *
 * - an account stays at the end it is already on wherever the new kind keeps one there, so an
 *   income into a card that becomes a transfer still arrives *into* that card;
 * - the single account of an expense or an income moves to whichever end the new kind leaves
 *   waiting (an expense from a card becoming an income lands in that same card);
 * - the payee of an expense becomes the payer of an income, and the other way round.
 *
 * `null` is an end this cannot answer for — the second own account a transfer needs, or the payee
 * a transfer never had. The screen shows those empty and won't save until they are filled.
 */
export function rewireForType(from: TxType, to: TxType, ends: TxEnds): EditChanges {
  const own = ownEnds(to);
  const kept = ownEnds(from).filter((end) => own.includes(end) && idAt(ends, end));
  const spare = ownEnds(from)
    .filter((end) => !kept.includes(end))
    .map((end) => idAt(ends, end))
    .filter((id): id is string => !!id);
  // Left to right, because a spare account goes to the first end still waiting for one.
  const take = (end: End) =>
    !own.includes(end) ? null : kept.includes(end) ? idAt(ends, end) : (spare.shift() ?? null);
  const sourceId = take('source');
  const destinationId = take('destination');

  const was = partyEnd(from);
  const party =
    was === 'source' ? ends.sourceName : was === 'destination' ? ends.destinationName : null;
  const becomes = partyEnd(to);

  return {
    type: to,
    source_id: sourceId,
    destination_id: destinationId,
    source_name: becomes === 'source' ? party : null,
    destination_name: becomes === 'destination' ? party : null,
  };
}

/** Whether both ends say enough for Firefly III to take the transaction as this kind. */
export function endsReady(type: TxType, ends: TxEnds): boolean {
  const own = ownEnds(type);
  const filled = (end: End) => {
    const id = idAt(ends, end);
    if (own.includes(end)) return !!id;
    // A payee end takes a name as well as an id: a new one is created when it is sent.
    return !!(id ?? (end === 'source' ? ends.sourceName : ends.destinationName));
  };
  // FF3 refuses a transfer from an account to itself.
  if (type === 'transfer' && ends.sourceId && ends.sourceId === ends.destinationId) return false;
  return filled('source') && filled('destination');
}
