import { useQuery } from '@tanstack/react-query';
import { useDb } from '../providers/DbProvider';
import { getCachedFlags, getFlagOverrides } from '../settings/appSettings';
import type { OutboxDb } from '../sync/outbox';
import type { FlagName } from './registry';
import { resolveAll, resolveFlag } from './resolve';

export const FLAGS_QUERY_KEY = ['feature-flags'] as const;

// What every flag reads as before the cache loads: the code defaults.
const DEFAULTS = resolveAll({});

/** The cached flags with overrides applied; shared by useFlags and RequireFlag. */
export function flagsQuery(db: OutboxDb) {
  return {
    queryKey: FLAGS_QUERY_KEY,
    queryFn: async () => resolveAll(await getCachedFlags(db), await getFlagOverrides(db)),
    staleTime: Infinity, // FlagsSync invalidates this when it stores a fresh answer
  };
}

export function useFlags(): Record<FlagName, boolean> {
  const { data } = useQuery(flagsQuery(useDb()));
  return data ?? DEFAULTS;
}

export function useFlag(name: FlagName): boolean {
  return useFlags()[name];
}

/** For non-React code paths (background work, a one-off check before an action). */
export async function isFlagOn(db: OutboxDb, name: FlagName): Promise<boolean> {
  return resolveFlag(name, await getCachedFlags(db), await getFlagOverrides(db));
}
