import { DetailRows, type DetailRowsValue, type UnsureRow } from '../DetailRows';
import type { useDraftReferenceData } from './useDraftReferenceData';

export interface DraftDetailRowsProps {
  value: DetailRowsValue;
  onChange: (change: Partial<DetailRowsValue>) => void;
  onDatePress: () => void;
  payee?: { name: string | null | undefined; onPress: () => void };
  errorMessage?: string | null;
  onRetryError?: () => void;
  unsureRows: ReadonlySet<UnsureRow>;
  readOnly?: boolean;
  referenceData: ReturnType<typeof useDraftReferenceData>;
}

export function DraftDetailRows({
  value,
  onChange,
  onDatePress,
  payee,
  errorMessage,
  onRetryError,
  unsureRows,
  readOnly,
  referenceData,
}: DraftDetailRowsProps) {
  return (
    <DetailRows
      value={value}
      onChange={onChange}
      onDatePress={onDatePress}
      payee={payee}
      statusRow={
        errorMessage && !readOnly && onRetryError
          ? {
              message: errorMessage,
              onRetry: onRetryError,
            }
          : undefined
      }
      unsure={unsureRows}
      readOnly={readOnly}
      accounts={referenceData.assetAccounts}
      currencies={referenceData.currencies}
      sharedPeople={referenceData.sharedPeople}
      tagsSuggestions={referenceData.recentTags}
      categories={referenceData.categories}
      budgets={referenceData.budgets}
      loading={referenceData.referenceLoading}
    />
  );
}
