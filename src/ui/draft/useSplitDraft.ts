import { useState } from 'react';
import type { AllocationMode, AllocationResult } from '../AllocationSheet';
import type { Draft } from '../../inbox/draft';
import {
  addSplit,
  draftAmounts,
  draftTotal,
  patchExtraSplit,
  removeSplitFromDraft,
  withAmounts,
} from '../../inbox/draftSplits';
import { absorb, leftover } from '../../splits/allocate';
import { askLeftover, placeLeftover, type LeftoverHandlers } from '../../splits/placeLeftover';

export interface UseSplitDraftParams {
  draft: Draft;
  dp: number;
  accountCurrencyCode: string | null | undefined;
  patch: (fields: Partial<Draft>) => void;
}

export function useSplitDraft({ draft, dp, accountCurrencyCode, patch }: UseSplitDraftParams) {
  const [page, setPage] = useState(0);
  const [allocation, setAllocation] = useState<AllocationMode | null>(null);
  const [keypadFor, setKeypadFor] = useState<number | 'total' | 'foreign' | null>(null);
  const [textFor, setTextFor] = useState<number | 'title' | null>(null);
  const [extraPayeeFor, setExtraPayeeFor] = useState<number | null>(null);

  const extras = draft.extraSplits ?? [];
  const amounts = draftAmounts(draft);
  const total = draftTotal(draft);

  const leftoverHandlers: LeftoverHandlers = {
    write: (next) => patch(withAmounts(draft, next)),
    ask: (delta, exclude) => setAllocation({ kind: 'leftover', delta, exclude }),
  };

  const place = (nextAmounts: string[], nextTotal: string, exclude?: number) =>
    placeLeftover(nextAmounts, nextTotal, dp, leftoverHandlers, exclude);

  function onAllocated(result: AllocationResult) {
    if (!allocation) return;
    if (allocation.kind === 'newSplit' && result.newAmount) {
      patch(addSplit(draft, result.amounts, result.newAmount));
      setPage(extras.length + 1);
    } else {
      patch(withAmounts(draft, result.amounts));
    }
    setAllocation(null);
  }

  function removeSplit(index: number) {
    const next = removeSplitFromDraft(draft, index);
    const nextAmounts = amounts.filter((_, i) => i !== index);
    const delta = leftover(total, nextAmounts, dp);
    const absorbed = nextAmounts.length > 1 ? absorb(nextAmounts, delta, dp) : null;
    patch(absorbed ? { ...next, ...withAmounts({ ...draft, ...next }, absorbed) } : next);
    setPage(Math.max(0, Math.min(index, nextAmounts.length - 1)));
    if (nextAmounts.length > 1 && !absorbed)
      askLeftover(nextAmounts, total, dp, leftoverHandlers.ask);
  }

  function commitKeypad(typed: string | null) {
    const target = keypadFor;
    setKeypadFor(null);
    if (target === null) return;
    if (target === 'foreign') {
      if (typed !== null)
        patch({ foreignAmount: typed, foreignCurrencyCode: accountCurrencyCode ?? undefined });
      return;
    }
    if (target === 'total') {
      const nextTotal = typed ?? total;
      if (typed !== null) patch({ total: typed });
      place(amounts, nextTotal);
      return;
    }
    const split = target === 0 ? null : extras[target - 1];
    if (target !== 0 && !split) return;
    const nextAmounts =
      typed === null ? amounts : amounts.map((a, i) => (i === target ? typed : a));
    if (typed !== null)
      patch(split ? patchExtraSplit(draft, target - 1, { amount: typed }) : { amount: typed });
    place(nextAmounts, total, target);
  }

  const textField: { value: string; onChange: (value: string) => void } =
    textFor === 'title'
      ? {
          value: draft.groupTitle ?? draft.description,
          onChange: (groupTitle) => patch({ groupTitle }),
        }
      : textFor === 0
        ? { value: draft.description, onChange: (description) => patch({ description }) }
        : typeof textFor === 'number'
          ? {
              value: extras[textFor - 1]?.description ?? '',
              onChange: (description) =>
                patch(patchExtraSplit(draft, textFor - 1, { description })),
            }
          : { value: '', onChange: () => {} };

  function startSplit() {
    setAllocation({ kind: 'newSplit' });
  }

  function selectExtraPayee(name: string, isNew: boolean) {
    if (extraPayeeFor !== null) {
      patch(
        patchExtraSplit(draft, extraPayeeFor - 1, {
          payeeName: name,
          payeeId: undefined,
          isNewPayee: isNew,
        }),
      );
    }
  }

  return {
    page,
    setPage,
    allocation,
    setAllocation,
    keypadFor,
    setKeypadFor,
    textFor,
    setTextFor,
    textField,
    extraPayeeFor,
    setExtraPayeeFor,
    onAllocated,
    removeSplit,
    commitKeypad,
    leftoverHandlers,
    startSplit,
    selectExtraPayee,
  };
}
