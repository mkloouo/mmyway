// Splits on a draft (src/inbox/draft.ts's extraSplits): the draft's own fields are split 1, the
// extras are splits 2..N. Pure — each helper returns the patch for updateDraft.
import type { Draft, DraftSplit } from './draft';
import { fromMinor, sumMinor } from '../splits/allocate';

/** Plenty for any currency: amounts are compared, never shown, at this scale. */
const SCALE = 12;

export function draftAmounts(draft: Draft): string[] {
  return [draft.amount, ...(draft.extraSplits ?? []).map((s) => s.amount)];
}

/** The total the user tracks, or the splits' sum when none is tracked (a plain entry). */
export function draftTotal(draft: Draft): string {
  if (draft.total !== undefined) return draft.total;
  if (!draft.extraSplits?.length) return draft.amount;
  return trimZeros(fromMinor(sumMinor(draftAmounts(draft), SCALE), SCALE));
}

function trimZeros(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

export function isSplitDraft(draft: Draft): boolean {
  return (draft.extraSplits?.length ?? 0) > 0;
}

/** New amounts for every split (index 0 is the draft's own amount). */
export function withAmounts(draft: Draft, amounts: string[]): Partial<Draft> {
  const extras = draft.extraSplits ?? [];
  return {
    amount: amounts[0] ?? draft.amount,
    ...(extras.length > 0
      ? { extraSplits: extras.map((s, i) => ({ ...s, amount: amounts[i + 1] ?? s.amount })) }
      : {}),
  };
}

/** The payee of split 1, which a new split starts with. */
function firstPayee(draft: Draft): Pick<DraftSplit, 'payeeName' | 'payeeId'> {
  if (draft.type === 'withdrawal')
    return { payeeName: draft.destinationName, payeeId: draft.destinationId };
  if (draft.type === 'deposit') return { payeeName: draft.sourceName, payeeId: draft.sourceId };
  return {};
}

/**
 * The Split button: `amounts` are the existing splits after giving up `newAmount` (the allocation
 * sheet's result). The total is tracked from here on, at what it was before the split.
 */
export function addSplit(draft: Draft, amounts: string[], newAmount: string): Partial<Draft> {
  const split: DraftSplit = {
    amount: newAmount,
    description: draft.description,
    isNewPayee: draft.isNewPayee,
    ...firstPayee(draft),
  };
  const base = withAmounts(draft, amounts);
  return {
    ...base,
    extraSplits: [...(base.extraSplits ?? draft.extraSplits ?? []), split],
    total: draftTotal(draft),
    groupTitle: draft.groupTitle ?? draft.description,
  };
}

export function patchExtraSplit(
  draft: Draft,
  index: number,
  patch: Partial<DraftSplit>,
): Partial<Draft> {
  return {
    extraSplits: (draft.extraSplits ?? []).map((s, i) => (i === index ? { ...s, ...patch } : s)),
  };
}

/**
 * Removes split `index` (1..N; split 1 is the draft itself and stays). Its money becomes leftover
 * for the user to reassign; when only split 1 is left the draft is a plain entry again, holding
 * the whole total.
 */
export function removeExtraSplit(draft: Draft, index: number): Partial<Draft> {
  const extras = (draft.extraSplits ?? []).filter((_, i) => i !== index - 1);
  if (extras.length > 0) return { extraSplits: extras };
  return {
    extraSplits: undefined,
    total: undefined,
    groupTitle: undefined,
    amount: draftTotal(draft),
  };
}
