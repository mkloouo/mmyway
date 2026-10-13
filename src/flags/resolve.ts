import { FLAGS, FLAG_NAMES, type FlagName, type FlagValues } from './registry';

export function resolveFlag(
  name: FlagName,
  remote: FlagValues,
  overrides: FlagValues = {},
): boolean {
  return overrides[name] ?? remote[name] ?? FLAGS[name].default;
}

export function resolveAll(
  remote: FlagValues,
  overrides: FlagValues = {},
): Record<FlagName, boolean> {
  const all = {} as Record<FlagName, boolean>;
  for (const name of FLAG_NAMES) all[name] = resolveFlag(name, remote, overrides);
  return all;
}
