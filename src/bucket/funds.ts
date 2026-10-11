// Piggy banks -> the Budget tab's sinking funds. Pure, no db, no fetch.
import { compareDecimal, subtractDecimal } from '../api/ff3/decimal';
import type { BucketObject, PiggyAttributes } from './objects';

export interface Fund {
  id: string;
  name: string;
  /** `accounts[].current_amount` as FF3 holds it: what has been put aside. */
  saved: string;
  /** null for an open-ended fund — FF3 stores "no target" as `target_amount: '0'` (plan §0). */
  target: string | null;
  targetDate: string | null;
  percentage: number | null;
  /** The asset account the money sits in; the one a change is written against. */
  accountId: string | null;
  accountName: string | null;
  currencyCode: string | null;
  groupTitle: string | null;
  /** For the conflict check: FF3's own web UI can move a piggy bank too. */
  updatedAt: string | null;
}

export function fundsFrom(objects: readonly BucketObject[]): Fund[] {
  return objects
    .filter((o) => o.kind === 'piggy')
    .map((o) => {
      const a = o.attributes as PiggyAttributes;
      const account = a.accounts?.[0];
      const target = a.target_amount ?? null;
      return {
        id: o.ff3Id,
        name: a.name ?? '',
        saved: a.current_amount ?? '0',
        target: target && compareDecimal(target, '0') > 0 ? target : null,
        targetDate: a.target_date ? a.target_date.slice(0, 10) : null,
        percentage: typeof a.percentage === 'number' ? a.percentage : null,
        accountId: account?.id != null ? String(account.id) : null,
        accountName: account?.name ?? null,
        currencyCode: a.currency_code ?? null,
        groupTitle: a.object_group_title ?? null,
        updatedAt: a.updated_at ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What is still missing before a fund reaches its target; `null` for an open-ended one. */
export function fundShortfall(fund: Fund): string | null {
  if (!fund.target) return null;
  return compareDecimal(fund.target, fund.saved) > 0
    ? subtractDecimal(fund.target, fund.saved)
    : '0';
}
