import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useDb } from '../providers/DbProvider';
import { setCachedFlags } from '../settings/appSettings';
import { errorMessage } from '../utils/errorMessage';
import { logLine } from '../utils/log';
import { fetchFlags, flagsmithConfig } from './flagsmith';
import { FLAGS_QUERY_KEY } from './useFlag';

// A resume within a minute of the last good fetch isn't worth another request.
const REFRESH_THROTTLE_MS = 60 * 1000;
let lastFetchedAt = 0;

// Refreshes the cached flags on launch and on each return to the foreground. Renders nothing;
// on failure the cache stays as it was and the app keeps running on it.
export function FlagsSync() {
  const db = useDb();
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = async () => {
      const config = flagsmithConfig();
      if (!config) return;
      if (Date.now() - lastFetchedAt < REFRESH_THROTTLE_MS) return;
      try {
        await setCachedFlags(db, await fetchFlags(config));
        lastFetchedAt = Date.now();
        await queryClient.invalidateQueries({ queryKey: FLAGS_QUERY_KEY });
      } catch (err) {
        logLine('warn', `feature flags refresh failed: ${errorMessage(err)}`);
      }
    };
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [db, queryClient]);
  return null;
}
