// A modal screen takes a few hundred ms to cover the button that opened it; every tap in that
// window pushed another copy (ten stacked Capture screens, each to be closed by hand). One push
// per window, app-wide — a second tap on any opener inside it is dropped.
import { router, type Href } from 'expo-router';

const WINDOW_MS = 800;
let lastPushAt = 0;

export function navigateOnce(href: Href): void {
  const now = Date.now();
  if (now - lastPushAt < WINDOW_MS) return;
  lastPushAt = now;
  router.push(href);
}
