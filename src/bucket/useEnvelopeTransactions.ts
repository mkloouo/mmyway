// Returns the latest transactions spent from an envelope during the current budget period.
import { and, desc, eq, gte, lte, or } from 'drizzle-orm';
import { useMemo } from 'react';
import { cachedTransactions } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';
import type { Period } from './period';

export interface EnvelopeTransaction {
  groupId: string;
  description: string;
  date: string;
  amount: string;
  payee: string;
}

export function useEnvelopeTransactions(
  budgetId: string | null | undefined,
  envelopeName: string | null | undefined,
  period: Period,
  limitCount = 3,
): EnvelopeTransaction[] {
  const db = useDb();
  const periodEndIso = `${period.end}T23:59:59.999Z`;

  const budgetCondition =
    budgetId && envelopeName
      ? or(
          eq(cachedTransactions.budgetId, budgetId),
          eq(cachedTransactions.budgetName, envelopeName),
        )
      : budgetId
        ? eq(cachedTransactions.budgetId, budgetId)
        : envelopeName
          ? eq(cachedTransactions.budgetName, envelopeName)
          : null;

  const { data: rows } = useLiveQuery(
    budgetCondition
      ? db
          .select({
            groupId: cachedTransactions.groupId,
            description: cachedTransactions.description,
            date: cachedTransactions.date,
            amount: cachedTransactions.amount,
            destinationName: cachedTransactions.destinationName,
            sourceName: cachedTransactions.sourceName,
            type: cachedTransactions.type,
          })
          .from(cachedTransactions)
          .where(
            and(
              budgetCondition,
              gte(cachedTransactions.date, period.start),
              lte(cachedTransactions.date, periodEndIso),
            ),
          )
          .orderBy(desc(cachedTransactions.date))
          .limit(limitCount)
      : db.select().from(cachedTransactions).limit(0),
    [budgetId, envelopeName, period.start, period.end, limitCount],
    !!budgetCondition,
  );

  return useMemo(
    () =>
      (rows ?? []).map((row) => ({
        groupId: row.groupId,
        description: row.description,
        date: row.date,
        amount: row.amount,
        payee: row.type === 'deposit' ? (row.sourceName ?? '') : (row.destinationName ?? ''),
      })),
    [rows],
  );
}
