// The Budget tab's data, live off SQLite: the open period's envelopes, the previous period's (for
// "what you assigned last month"), the sinking funds, the bills due, and Ready to Assign.
import { eq, inArray } from 'drizzle-orm';
import { useMemo } from 'react';
import { bucketObjects, outboxOperations, plannedObjects, referenceAccounts } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import { useBudgetRows, useCurrencies } from '../db/useReferenceData';
import { useDb } from '../providers/DbProvider';
import { currencyOf, type DisplayCurrency } from '../ui/money';
import { billsDueIn, type BillDue } from '../sync/bucketData';
import { tryReadPayload } from '../sync/payloadJson';
import { envelopesFor, type Envelope } from './envelopes';
import type { SetBudgetLimitsPayload, SetPiggyAmountPayload } from './replay';
import { fundsFrom, type Fund } from './funds';
import { readBucketRow, type BucketObject } from './objects';
import { periodOf, previousPeriod, type Period } from './period';
import { readyToAssign, type Rta } from './rta';
import { localDay } from '../utils/day';

interface BucketData {
  period: Period;
  previous: Period;
  envelopes: Envelope[];
  /** The same budgets as last period had them, by budget id: the auto-fill target. */
  lastPeriod: Map<string, Envelope>;
  funds: Fund[];
  bills: BillDue[];
  rta: Rta;
  currency: DisplayCurrency;
  currencyCode: string;
  /** Budget ids whose assignment is still waiting in the outbox, for a pending dot. */
  queued: Set<string>;
  /** The same for sinking funds, by piggy bank id. */
  queuedFunds: Set<string>;
  loaded: boolean;
}

export function useBucket(): BucketData {
  const db = useDb();
  const { data: rows } = useLiveQuery(db.select().from(bucketObjects));
  const { data: planned } = useLiveQuery(db.select().from(plannedObjects));
  const { data: accounts } = useLiveQuery(
    db.select().from(referenceAccounts).where(eq(referenceAccounts.type, 'asset')),
  );
  const { data: ops } = useLiveQuery(
    db
      .select()
      .from(outboxOperations)
      .where(inArray(outboxOperations.kind, ['set_budget_limits', 'set_piggy_amount'])),
  );
  const budgets = useBudgetRows();
  const currencies = useCurrencies();

  return useMemo(() => {
    const period = periodOf(localDay());
    const previous = previousPeriod(period);
    const objects = (rows ?? []).map(readBucketRow).filter((o): o is BucketObject => !!o);
    const code = currencies.find((c) => c.isDefault)?.code ?? currencies[0]?.code ?? 'EUR';
    const currency = currencyOf(currencies, code);
    const envelopes = envelopesFor(budgets ?? [], objects, period.start, code);
    const lastPeriod = new Map(
      envelopesFor(budgets ?? [], objects, previous.start, code).map((e) => [e.budgetId, e]),
    );
    const funds = fundsFrom(objects);
    const bills = billsDueIn(planned ?? [], period);
    const queued = new Set<string>();
    const queuedFunds = new Set<string>();
    for (const op of ops ?? []) {
      if (op.kind === 'set_piggy_amount') {
        const p = tryReadPayload<SetPiggyAmountPayload>(op.kind, op.payloadJson);
        if (p?.piggyId) queuedFunds.add(p.piggyId);
        continue;
      }
      const p = tryReadPayload<SetBudgetLimitsPayload>(op.kind, op.payloadJson);
      for (const entry of p?.entries ?? []) queued.add(entry.budgetId);
    }
    return {
      period,
      previous,
      envelopes,
      lastPeriod,
      funds,
      bills,
      rta: readyToAssign({
        cash: (accounts ?? []).filter((a) => a.active).map((a) => a.currentBalance ?? '0'),
        envelopeAvailable: envelopes.map((e) => e.available),
        fundsSaved: funds.map((f) => f.saved),
        billsDue: bills.map((b) => b.amount),
        decimalPlaces: currency.decimalPlaces,
      }),
      currency,
      currencyCode: code,
      queued,
      queuedFunds,
      loaded: rows !== undefined && budgets !== undefined,
    };
  }, [rows, planned, accounts, ops, budgets, currencies]);
}
