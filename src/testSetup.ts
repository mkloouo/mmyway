import { Query, Mutation, notifyManager, timeoutManager } from '@tanstack/react-query';

// In Jest, unref timers so background tasks or open handles don't keep Jest worker processes hanging.
const origSetTimeout = global.setTimeout;
(global as any).setTimeout = function (cb: any, delay: any, ...args: any[]) {
  const timer = origSetTimeout(cb, delay, ...args);
  (timer as unknown as { unref?: () => void })?.unref?.();
  return timer;
};

const origSetInterval = global.setInterval;
(global as any).setInterval = function (cb: any, delay: any, ...args: any[]) {
  const timer = origSetInterval(cb, delay, ...args);
  (timer as unknown as { unref?: () => void })?.unref?.();
  return timer;
};

timeoutManager.setTimeoutProvider({
  setTimeout: (cb, delay) => {
    const timer = origSetTimeout(cb, delay);
    (timer as unknown as { unref?: () => void })?.unref?.();
    return timer;
  },
  clearTimeout: (id) => clearTimeout(id as any),
  setInterval: (cb, delay) => {
    const timer = origSetInterval(cb, delay);
    (timer as unknown as { unref?: () => void })?.unref?.();
    return timer;
  },
  clearInterval: (id) => clearInterval(id as any),
});

(Query.prototype as unknown as { scheduleGc: () => void }).scheduleGc = () => {};
(Mutation.prototype as unknown as { scheduleGc: () => void }).scheduleGc = () => {};
notifyManager.setScheduler((fn) => fn());
