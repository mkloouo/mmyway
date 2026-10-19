import { useMemo } from 'react';
import { useDb } from '../providers/DbProvider';
import { useLiveQuery } from '../db/useLiveQuery';
import { payeeAliases, plannedObjects, referenceAccounts } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';

export interface SettingsCounts {
  liabilitiesCount: number;
  aliasesCount: number;
  rulesCount: number;
  subscriptionsCount: number;
}

/**
 * Counts for the Settings tab (board 26 / MKL-89 / MKL-88 #13):
 * Loans and debts, Payee nicknames, Rules, and Subscriptions & recurring.
 */
export function useSettingsCounts(): SettingsCounts {
  const db = useDb();
  const { data: aliasRows } = useLiveQuery(db.select().from(payeeAliases));
  const { data: liabilityRows } = useLiveQuery(
    db.select().from(referenceAccounts).where(eq(referenceAccounts.type, 'liability')),
  );
  const { data: plannedRows } = useLiveQuery(
    db
      .select()
      .from(plannedObjects)
      .where(inArray(plannedObjects.kind, ['bill', 'recurrence', 'rule'])),
  );

  return useMemo(() => {
    let rulesCount = 0;
    let subscriptionsCount = 0;
    for (const row of plannedRows ?? []) {
      if (row.kind === 'rule') {
        rulesCount++;
      } else if (row.kind === 'bill' || row.kind === 'recurrence') {
        subscriptionsCount++;
      }
    }
    const liabilities = (liabilityRows ?? []).filter((a) => a.active).length;
    return {
      aliasesCount: aliasRows?.length ?? 0,
      liabilitiesCount: liabilities,
      rulesCount,
      subscriptionsCount,
    };
  }, [aliasRows, liabilityRows, plannedRows]);
}
