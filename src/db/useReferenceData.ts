// FF3's reference tables, live, for the screens that show them. Each returns `[]` rather than
// `undefined`, so no call site needs a `?? []` — a screen that must tell "loading" from "empty"
// reads the table through `useLiveQuery` itself.
import { referenceBudgets, referenceCategories, referenceCurrencies } from './schema';
import { useLiveQuery } from './useLiveQuery';
import { useDb } from '../providers/DbProvider';

const EMPTY: never[] = [];

/**
 * undefined until the first read lands. A screen that draws an amount wants this: `currencyOf`
 * falls back to the currency *code* as the symbol, so "12,00 PLN" would be replaced by "12,00 zł"
 * a frame later and the amount would visibly shift.
 */
export function useCurrencyRows(): (typeof referenceCurrencies.$inferSelect)[] | undefined {
  const db = useDb();
  const { data } = useLiveQuery(db.select().from(referenceCurrencies));
  return data;
}

export function useCurrencies(): (typeof referenceCurrencies.$inferSelect)[] {
  return useCurrencyRows() ?? EMPTY;
}

export function useCategories(): (typeof referenceCategories.$inferSelect)[] {
  const db = useDb();
  const { data } = useLiveQuery(db.select().from(referenceCategories));
  return data ?? EMPTY;
}

/** undefined until the first read lands, for a screen that shows a spinner instead of "—". */
export function useBudgetRows(): (typeof referenceBudgets.$inferSelect)[] | undefined {
  const db = useDb();
  const { data } = useLiveQuery(db.select().from(referenceBudgets));
  return data;
}

export function useBudgets(): (typeof referenceBudgets.$inferSelect)[] {
  return useBudgetRows() ?? EMPTY;
}
