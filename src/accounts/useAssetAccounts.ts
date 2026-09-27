// The one place a screen gets "the user's asset accounts" from. Inactive accounts are hidden
// everywhere except the full account list (Settings → Accounts), which passes includeInactive so
// the user can switch them back on.
import { useMemo } from 'react';
import { useLiveQuery } from '../db/useLiveQuery';
import { useDb } from '../providers/DbProvider';
import { referenceAccounts } from '../db/schema';

export type ReferenceAccountRow = typeof referenceAccounts.$inferSelect;

/** Pure half of useAssetAccounts, for tests and non-hook callers. */
export function selectAssetAccounts(rows: ReferenceAccountRow[], opts: { includeInactive?: boolean } = {}): ReferenceAccountRow[] {
  return rows
    .filter((a) => a.type === 'asset' && (opts.includeInactive || a.active))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** undefined until the first read lands (see src/db/useLiveQuery.ts). */
export function useAssetAccounts(opts: { includeInactive?: boolean } = {}): ReferenceAccountRow[] | undefined {
  const db = useDb();
  const { data } = useLiveQuery(db.select().from(referenceAccounts));
  const includeInactive = !!opts.includeInactive;
  return useMemo(() => (data ? selectAssetAccounts(data, { includeInactive }) : undefined), [data, includeInactive]);
}
