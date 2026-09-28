// FF3's reference tables, live, for the screens that show them. Each returns `[]` rather than
// `undefined`, so no call site needs a `?? []` — a screen that must tell "loading" from "empty"
// reads the table through `useLiveQuery` itself.
import { referenceBudgets, referenceCategories, referenceCurrencies } from './schema';
import { useLiveQuery } from './useLiveQuery';
import { useDb } from '../providers/DbProvider';

const EMPTY: never[] = [];

export function useCurrencies(): (typeof referenceCurrencies.$inferSelect)[] {
  const db = useDb();
  const { data } = useLiveQuery(db.select().from(referenceCurrencies));
  return data ?? EMPTY;
}

export function useCategories(): (typeof referenceCategories.$inferSelect)[] {
  const db = useDb();
  const { data } = useLiveQuery(db.select().from(referenceCategories));
  return data ?? EMPTY;
}

export function useBudgets(): (typeof referenceBudgets.$inferSelect)[] {
  const db = useDb();
  const { data } = useLiveQuery(db.select().from(referenceBudgets));
  return data ?? EMPTY;
}
