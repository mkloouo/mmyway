// The one place a screen gets "the user's asset accounts" from. Inactive accounts are hidden
// everywhere except the full account list (Settings → Accounts), which passes includeInactive so
// the user can switch them back on. The screens where an account is picked for a transaction also
// pass includeLiabilities: a loan, debt or mortgage can be paid from, paid into or transferred to.
// Balances, the cash count and account settings stay assets only.
import { useMemo } from 'react';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';
import { eq } from 'drizzle-orm';
import { appSettings, referenceAccounts } from '../db/schema';
import { ACCOUNT_ORDER_KEY, parseAccountOrder } from '../settings/appSettings';

export type ReferenceAccountRow = typeof referenceAccounts.$inferSelect;

/** Pure half of useAssetAccounts, for tests and non-hook callers. */
/** Sorted by FF3's own account order (Settings → Accounts → Reorder), then by name. */
export function selectAssetAccounts(
  rows: ReferenceAccountRow[],
  opts: {
    includeInactive?: boolean;
    includeLiabilities?: boolean;
    order?: Record<string, number>;
  } = {},
): ReferenceAccountRow[] {
  const order = opts.order ?? {};
  const rank = (a: ReferenceAccountRow) => order[a.id] ?? Number.MAX_SAFE_INTEGER;
  return rows
    .filter(
      (a) =>
        (a.type === 'asset' || (opts.includeLiabilities && a.type === 'liability')) &&
        (opts.includeInactive || a.active),
    )
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** undefined until the first read lands (see src/db/useLiveQuery.ts). */
export function useAssetAccounts(
  opts: { includeInactive?: boolean; includeLiabilities?: boolean } = {},
): ReferenceAccountRow[] | undefined {
  const db = useDb();
  const { data } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: orderRows } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.key, ACCOUNT_ORDER_KEY)),
  );
  const includeInactive = !!opts.includeInactive;
  const includeLiabilities = !!opts.includeLiabilities;
  const rawOrder = orderRows?.[0]?.value;
  return useMemo(
    () =>
      data
        ? selectAssetAccounts(data, {
            includeInactive,
            includeLiabilities,
            order: parseAccountOrder(rawOrder),
          })
        : undefined,
    [data, includeInactive, includeLiabilities, rawOrder],
  );
}
