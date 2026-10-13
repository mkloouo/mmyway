import type { ComponentType, ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useDb } from '../providers/DbProvider';
import type { FlagName } from './registry';
import { flagsQuery } from './useFlag';

/**
 * Wraps a screen that belongs to a flagged feature: with the flag off, a deep link or stale
 * navigation lands on the Inbox instead. Renders nothing until the cached flags have loaded, so
 * a flag that Flagsmith turned on doesn't bounce the user on the first frame.
 */
export function RequireFlag({ name, children }: { name: FlagName; children: ReactNode }) {
  const { data } = useQuery(flagsQuery(useDb()));
  if (!data) return null;
  return data[name] ? children : <Redirect href="/" />;
}

/** The one-line form for a route file: `export default withFlag('budget', BudgetScreen);` */
export function withFlag<P extends object>(name: FlagName, Screen: ComponentType<P>) {
  return function FlaggedRoute(props: P) {
    return (
      <RequireFlag name={name}>
        <Screen {...props} />
      </RequireFlag>
    );
  };
}
