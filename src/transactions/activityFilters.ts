import type { ActivityTypeFilter } from './useTransactionPage';

export interface ActivityFilterOption {
  labelKey: string;
  type: ActivityTypeFilter;
}

export const FILTERS: readonly ActivityFilterOption[] = [
  { labelKey: 'activity.filterAll', type: 'all' },
  { labelKey: 'activity.filterSpending', type: 'withdrawal' },
  { labelKey: 'activity.filterIncome', type: 'deposit' },
  { labelKey: 'activity.filterMoves', type: 'transfer' },
];
