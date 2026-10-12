// Demo mode: the app filled with sample data from src/demo/seed.ts and nothing sent anywhere. It
// only runs signed out — runSync returns NOT_SIGNED_IN without stored credentials, so the demo's
// queued captures never reach a server. Leaving the demo deletes everything made in it.
import { readStoredCredentials } from '../api/ff3/auth';
import { inboxItems, outboxOperations } from '../db/schema';
import { setDemoMode } from '../settings/appSettings';
import { clearInstanceData } from '../sync/instanceData';
import type { OutboxDb } from '../sync/outbox';
import { loadDemoData } from './seed';

export { getDemoMode } from '../settings/appSettings';

type StartDemoResult =
  | { status: 'started' }
  | { status: 'signed_in' }
  /** Something real is still on the phone (a queued change or an inbox item); leaving the demo would delete it. */
  | { status: 'has_data' };

/**
 * Replaces what is on the phone with the demo's sample data. Refused while signed in: the demo
 * would otherwise sit on top of a real instance's data, and its captures would replay into it.
 */
export async function startDemo(db: OutboxDb, today: Date = new Date()): Promise<StartDemoResult> {
  if (await readStoredCredentials()) return { status: 'signed_in' };
  const [queued, inbox] = await Promise.all([
    db.select({ id: outboxOperations.id }).from(outboxOperations).limit(1),
    db.select({ id: inboxItems.id }).from(inboxItems).limit(1),
  ]);
  if (queued.length > 0 || inbox.length > 0) return { status: 'has_data' };
  await clearInstanceData(db);
  await loadDemoData(db, today);
  await setDemoMode(db, true);
  return { status: 'started' };
}

/**
 * Deletes the demo: its sample data, every queued operation and every inbox item (all of them
 * were made in the demo), then turns demo mode off.
 */
export async function leaveDemo(db: OutboxDb): Promise<void> {
  await clearInstanceData(db);
  db.transaction((tx) => {
    tx.delete(outboxOperations).run();
    tx.delete(inboxItems).run();
  });
  await setDemoMode(db, false);
}
