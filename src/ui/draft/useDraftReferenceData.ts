import { useBudgetRows, useCategories, useCurrencyRows } from '../../db/useReferenceData';
import { useSharedPeople } from '../../lookup/sharedPeople';
import { useRecentTags } from '../../lookup/recentTags';
import { useAssetAccounts } from '../../accounts/useAssetAccounts';

export function useDraftReferenceData() {
  const accountRows = useAssetAccounts({ includeLiabilities: true });
  const assetAccounts = accountRows ?? [];
  const categories = useCategories();
  const sharedPeople = useSharedPeople();
  const recentTags = useRecentTags();
  const budgetRows = useBudgetRows();
  const budgets = budgetRows ?? [];
  const currencyRows = useCurrencyRows();
  const currencies = currencyRows ?? [];
  const currenciesLoading = currencyRows === undefined;
  const referenceLoading =
    currenciesLoading || accountRows === undefined || budgetRows === undefined;

  return {
    assetAccounts,
    categories,
    sharedPeople,
    recentTags,
    budgets,
    currencies,
    currenciesLoading,
    referenceLoading,
  };
}
