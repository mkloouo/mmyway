// Where an entry was made (#67). The phone's position is read while Capture (or the camera) is
// open and kept here until something saves; nothing ever waits on it, so an entry is never slower
// because the GPS was. "Balanced" accuracy on purpose: a place is good enough, and a fine fix
// costs battery and seconds.
//
// Foreground only. There is no watcher and no background task: each request is one fix, asked for
// when a screen that might book something opens.
import type { DraftLocation } from '../inbox/draft';
import { getRecordLocation } from '../settings/appSettings';
import type { OutboxDb } from '../sync/outbox';
import { logLine } from '../utils/log';
import { errorMessage } from '../utils/errorMessage';

/**
 * How long a fix stands in for "here". Capture is often open for a minute or two, and a receipt
 * photographed at the till is saved on the way out; a fix from an hour ago is a different place.
 */
const FRESH_FOR_MS = 10 * 60 * 1000;

/** 1e5: five decimal places. */
const PRECISION = 1e5;

let last: { at: number; position: DraftLocation } | null = null;
let inFlight = false;

/**
 * Asks for a fix, if location is on and the permission is given. Returns at once — the answer
 * lands in `recentPosition()` whenever it arrives, or never. Safe to call again; a second call
 * while one is in flight does nothing.
 */
export function startPositionRequest(db: OutboxDb): void {
  if (inFlight) return;
  inFlight = true;
  void (async () => {
    try {
      if (!(await getRecordLocation(db))) {
        last = null;
        return;
      }
      // Lazy require, not a module-scope import: this module is reached from the receipt capture
      // path, which several Jest suites import (see src/sync/outbox.ts's attach_receipt branch).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Location = require('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      last = { at: Date.now(), position: roundPosition(fix.coords) };
    } catch (err) {
      // No fix is a missing field on an entry, never a failed save.
      logLine('warn', `location unavailable: ${errorMessage(err)}`);
    } finally {
      inFlight = false;
    }
  })();
}

/** The last fix, if one arrived and is still recent enough to mean "here"; undefined otherwise. */
export function recentPosition(): DraftLocation | undefined {
  return freshPosition(last, Date.now());
}

/**
 * Drops the fix being held. Settings calls this when location is turned off: a Capture screen
 * already open would otherwise go on attaching the last fix until it is reopened.
 */
export function forgetPosition(): void {
  last = null;
}

/** recentPosition's rule, with the clock passed in. */
export function freshPosition(
  fix: { at: number; position: DraftLocation } | null,
  now: number,
): DraftLocation | undefined {
  if (!fix || now - fix.at > FRESH_FOR_MS) return undefined;
  return fix.position;
}

/** Five decimals is a few metres — more than a place needs, and less to store. */
export function roundPosition(coords: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}): DraftLocation {
  return {
    latitude: Math.round(coords.latitude * PRECISION) / PRECISION,
    longitude: Math.round(coords.longitude * PRECISION) / PRECISION,
    ...(coords.accuracy != null ? { accuracyM: Math.round(coords.accuracy) } : {}),
  };
}
