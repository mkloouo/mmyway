import { registerSyncHandler, retryUnsent } from './syncTrigger';

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
