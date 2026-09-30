import { registerSyncHandler, requestSync, retryUnsent, SYNC_DELAY } from './syncTrigger';

describe('retryUnsent', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retries what is still unsent, waiting longer each time until nothing is left', () => {
    const sync = jest.fn();
    const unregister = registerSyncHandler(sync);

    retryUnsent(true, null);
    jest.advanceTimersByTime(4_999);
    expect(sync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(sync).toHaveBeenCalledTimes(1);

    retryUnsent(true, null);
    jest.advanceTimersByTime(14_999);
    expect(sync).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(sync).toHaveBeenCalledTimes(2);

    // Sent: the next time something is left over starts from the shortest wait again.
    retryUnsent(false, null);
    retryUnsent(true, null);
    jest.advanceTimersByTime(5_000);
    expect(sync).toHaveBeenCalledTimes(3);

    unregister();
  });

  it('comes back for a failed change when it may be retried', () => {
    const sync = jest.fn();
    const unregister = registerSyncHandler(sync);

    retryUnsent(false, Date.now() + 60_000);
    jest.advanceTimersByTime(59_999);
    expect(sync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(sync).toHaveBeenCalledTimes(1);

    unregister();
  });
});

describe('requestSync', () => {
  // The undo floor is module state; each test starts on a clock past the previous one's window.
  let clock = Date.now();
  beforeEach(() => {
    jest.useFakeTimers();
    clock += 60_000;
    jest.setSystemTime(clock);
  });
  afterEach(() => jest.useRealTimers());

  it('sends a confirm at +6 s even while a retry is armed for an hour', () => {
    const sync = jest.fn();
    const unregister = registerSyncHandler(sync);

    retryUnsent(false, Date.now() + 60 * 60 * 1000);
    requestSync(SYNC_DELAY.afterConfirm);
    jest.advanceTimersByTime(5_999);
    expect(sync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(sync).toHaveBeenCalledTimes(1);

    unregister();
  });

  it('never sends a confirm inside its undo window for a later write or retry', () => {
    const sync = jest.fn();
    const unregister = registerSyncHandler(sync);

    requestSync(SYNC_DELAY.afterConfirm);
    requestSync(SYNC_DELAY.afterWrite);
    retryUnsent(true, null);
    jest.advanceTimersByTime(5_999);
    expect(sync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(sync).toHaveBeenCalledTimes(1);

    unregister();
  });

  it('sends an edit within a second while a retry is armed for later', () => {
    const sync = jest.fn();
    const unregister = registerSyncHandler(sync);

    retryUnsent(false, Date.now() + 60 * 60 * 1000);
    requestSync(SYNC_DELAY.afterWrite);
    jest.advanceTimersByTime(1_000);
    expect(sync).toHaveBeenCalledTimes(1);

    unregister();
  });
});
