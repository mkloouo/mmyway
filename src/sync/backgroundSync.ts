// Background sync (brief §5.4, nice-to-have): Android's WorkManager wakes the app roughly every
// 15 minutes, when the OS allows it, to send queued writes and refresh the cache. The task must be
// defined at module scope, so this file is imported once from app/_layout.tsx.
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { getDb, getMigrationDone } from '../db/client';
import { runSync } from './runSync';
import { logLine } from '../utils/log';

export const BACKGROUND_SYNC_TASK = 'mmyway-background-sync';

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    if (await getMigrationDone()) return BackgroundTask.BackgroundTaskResult.Failed;
    const summary = await runSync(getDb());
    if (summary.error) logLine('warn', `background sync: ${summary.error}`);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    logLine('error', `background sync failed: ${err instanceof Error ? err.message : String(err)}`);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Idempotent: registering an already-registered task only updates its interval. */
export async function registerBackgroundSync(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: 15 });
  } catch (err) {
    logLine('warn', `could not register background sync: ${err instanceof Error ? err.message : String(err)}`);
  }
}
