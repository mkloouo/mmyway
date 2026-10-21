import type { Draft } from '../../inbox/draft';
import type { DetailRowsValue } from '../DetailRows';
import { appLocale } from '../../i18n';

export function draftToDetailValue(draft: Draft): DetailRowsValue {
  return {
    type: draft.type,
    categoryName: draft.categoryName ?? null,
    sourceAccountId: draft.sourceId ?? null,
    destinationAccountId: draft.destinationId ?? null,
    budgetId: draft.budgetId ?? null,
    dateLabel: new Date(draft.date).toLocaleString(appLocale(), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    notes: draft.notes ?? null,
    tags: draft.extraTags ?? [],
    sharedWith: draft.sharedWith ?? null,
  };
}
