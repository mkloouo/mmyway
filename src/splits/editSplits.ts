// A split transaction as the detail screen edits it: every split, plus the fields every split of a
// group must share (FF3 rejects a withdrawal whose splits leave from different accounts). Pure.
import type { TransactionSplit } from '../api/ff3/types';
import type { CachedSplit } from '../transactions/splitsJson';
import type { QueuedSplit } from '../transactions/pendingEdits';

export type TxType = 'withdrawal' | 'deposit' | 'transfer';

export interface EditableSplit {
  journalId?: string; // absent for a split not yet in FF3
  amount: string;
  description: string;
  sourceId: string | null;
  sourceName: string | null;
  destinationId: string | null;
  destinationName: string | null;
  categoryName: string | null;
  budgetId: string | null;
  notes: string | null;
  tags: string[];
}

export function fromCached(split: CachedSplit): EditableSplit {
  return {
    journalId: split.journalId, amount: split.amount, description: split.description,
    sourceId: split.sourceId, sourceName: split.sourceName,
    destinationId: split.destinationId, destinationName: split.destinationName,
    categoryName: split.categoryName, budgetId: split.budgetId, notes: split.notes, tags: split.tags,
  };
}

const text = (value: unknown): string | null => (value == null || value === '' ? null : String(value));

export function fromQueued(split: QueuedSplit): EditableSplit {
  return {
    journalId: text(split.transaction_journal_id) ?? undefined,
    amount: split.amount ?? '0',
    description: split.description ?? '',
    sourceId: text(split.source_id), sourceName: text(split.source_name),
    destinationId: text(split.destination_id), destinationName: text(split.destination_name),
    categoryName: text(split.category_name), budgetId: text(split.budget_id), notes: text(split.notes),
    tags: split.tags ?? [],
  };
}

/** Which ends of a split are the group's own accounts, shared by all splits. */
export function sharedEnds(type: TxType): { source: boolean; destination: boolean } {
  return { source: type !== 'deposit', destination: type !== 'withdrawal' };
}

/**
 * A change to a field every split shares (the date is sent per split too) goes to all of them;
 * anything else only to split `index`.
 */
export function patchSplit(splits: readonly EditableSplit[], index: number, patch: Partial<EditableSplit>, type: TxType): EditableSplit[] {
  const ends = sharedEnds(type);
  const shared: Partial<EditableSplit> = {};
  if (ends.source && ('sourceId' in patch || 'sourceName' in patch)) Object.assign(shared, pick(patch, ['sourceId', 'sourceName']));
  if (ends.destination && ('destinationId' in patch || 'destinationName' in patch)) Object.assign(shared, pick(patch, ['destinationId', 'destinationName']));
  return splits.map((s, i) => (i === index ? { ...s, ...patch } : { ...s, ...shared }));
}

function pick<T extends object, K extends keyof T>(value: T, keys: K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (k in value) out[k] = value[k];
  return out;
}

/**
 * A new split: the same accounts and payee as split 1 (a receipt split by category is the common
 * case), its own amount, no category yet.
 */
export function newSplit(first: EditableSplit, amount: string, description: string): EditableSplit {
  return {
    amount, description,
    sourceId: first.sourceId, sourceName: first.sourceName,
    destinationId: first.destinationId, destinationName: first.destinationName,
    categoryName: null, budgetId: null, notes: null, tags: [],
  };
}

/** The PUT body's `transactions`: every split, the kept ones by journal id, the new ones without. */
export function toPayloadSplits(
  splits: readonly EditableSplit[],
  group: { type: TxType; date: string; currencyCode: string },
): QueuedSplit[] {
  return splits.map((s) => {
    const out: TransactionSplit & { transaction_journal_id?: string } = {
      type: group.type,
      date: group.date,
      amount: s.amount,
      currency_code: group.currencyCode,
      description: s.description,
      // An id when there is one; a payee picked by name (or new) goes by name.
      source_id: s.sourceId ?? undefined,
      source_name: s.sourceId ? undefined : (s.sourceName ?? undefined),
      destination_id: s.destinationId ?? undefined,
      destination_name: s.destinationId ? undefined : (s.destinationName ?? undefined),
      // Empty clears it in FF3; left out would keep what the split had.
      category_name: s.categoryName ?? '',
      budget_id: s.budgetId ?? undefined,
      notes: s.notes ?? '',
      tags: s.tags,
    } as TransactionSplit & { transaction_journal_id?: string };
    if (s.journalId) out.transaction_journal_id = s.journalId;
    return out;
  });
}
