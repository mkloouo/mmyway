import type { ReactNode } from 'react';
import { SplitPager } from '../SplitPager';
import { SplitPage } from '../SplitPage';
import { DetailRows, type DetailRowsValue } from '../DetailRows';
import type { DisplayCurrency } from '../../money/format';
import type { Draft, DraftSplit } from '../../inbox/draft';
import type { useDraftReferenceData } from './useDraftReferenceData';

export interface DraftSplitPagerProps {
  total: string;
  amounts: string[];
  pageIndex: number;
  onSelectPage: (index: number) => void;
  currency: DisplayCurrency;
  draft: Draft;
  extras: DraftSplit[];
  leftover: bigint;
  readOnly?: boolean;
  unsure: string[];
  payeeName?: string;
  detailValue: DetailRowsValue;
  referenceData: ReturnType<typeof useDraftReferenceData>;
  onTotalPress: () => void;
  onReassign: () => void;
  onAmountPress: (index: number) => void;
  onDescriptionPress: (index: number) => void;
  onPayeePress: (index: number) => void;
  onRemoveSplit: (index: number) => void;
  onExtraDetailChange: (index: number, change: Partial<DetailRowsValue>) => void;
  onDatePress: () => void;
  renderMainDetailRows: () => ReactNode;
}

export function DraftSplitPager({
  total,
  amounts,
  pageIndex,
  onSelectPage,
  currency,
  draft,
  extras,
  leftover,
  readOnly,
  unsure,
  payeeName,
  detailValue,
  referenceData,
  onTotalPress,
  onReassign,
  onAmountPress,
  onDescriptionPress,
  onPayeePress,
  onRemoveSplit,
  onExtraDetailChange,
  onDatePress,
  renderMainDetailRows,
}: DraftSplitPagerProps) {
  function renderSplitPage(index: number) {
    const split = index === 0 ? null : extras[index - 1];
    return (
      <SplitPage
        amount={split ? split.amount : draft.amount}
        currency={currency}
        type={draft.type}
        description={split ? split.description : draft.description}
        payee={split ? split.payeeName : payeeName}
        isNewPayee={split ? split.isNewPayee : draft.isNewPayee}
        readOnly={readOnly}
        amountTone={index === 0 && unsure.includes('amount') ? 'warn' : 'default'}
        onAmountPress={() => onAmountPress(index)}
        onDescriptionPress={() => onDescriptionPress(index)}
        onPayeePress={() => onPayeePress(index)}
        onRemove={amounts.length > 1 ? () => onRemoveSplit(index) : undefined}
      >
        {split ? (
          <DetailRows
            value={{
              ...detailValue,
              categoryName: split.categoryName ?? null,
              budgetId: split.budgetId ?? null,
              notes: split.notes ?? null,
              tags: split.extraTags ?? [],
              sharedWith: split.sharedWith ?? null,
            }}
            onChange={(change) => onExtraDetailChange(index, change)}
            onDatePress={onDatePress}
            readOnly={readOnly}
            accounts={referenceData.assetAccounts}
            currencies={referenceData.currencies}
            sharedPeople={referenceData.sharedPeople}
            tagsSuggestions={referenceData.recentTags}
            categories={referenceData.categories}
            budgets={referenceData.budgets}
            loading={referenceData.referenceLoading}
          />
        ) : (
          renderMainDetailRows()
        )}
      </SplitPage>
    );
  }

  return (
    <SplitPager
      total={total}
      count={amounts.length}
      index={pageIndex}
      onIndexChange={onSelectPage}
      currency={currency}
      type={draft.type}
      leftover={leftover}
      readOnly={readOnly}
      onTotalPress={onTotalPress}
      onReassign={onReassign}
      renderPage={renderSplitPage}
    />
  );
}
