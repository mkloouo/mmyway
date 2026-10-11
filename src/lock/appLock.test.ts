import { shouldLock, LOCK_GRACE_MS, canUseAppLock, authenticate } from './appLock';
import * as LocalAuthentication from 'expo-local-authentication';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

const mocked = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;

describe('shouldLock', () => {
  const now = 1_700_000_000_000;

  it('never locks while the setting is off, however stale the unlock is', () => {
    expect(shouldLock({ enabled: false, lastUnlockedAt: null, now })).toBe(false);
    expect(shouldLock({ enabled: false, lastUnlockedAt: 0, now })).toBe(false);
  });

  it('locks on launch — nothing has been unlocked this process', () => {
    expect(shouldLock({ enabled: true, lastUnlockedAt: null, now })).toBe(true);
  });

  it('stays unlocked inside the grace window, so handing off to the camera is not a re-lock', () => {
    expect(shouldLock({ enabled: true, lastUnlockedAt: now - 1, now })).toBe(false);
    expect(shouldLock({ enabled: true, lastUnlockedAt: now - LOCK_GRACE_MS, now })).toBe(false);
  });

  it('locks once the window has passed', () => {
    expect(shouldLock({ enabled: true, lastUnlockedAt: now - LOCK_GRACE_MS - 1, now })).toBe(true);
  });

  it('honours an explicit window', () => {
    expect(shouldLock({ enabled: true, lastUnlockedAt: now - 500, now, graceMs: 100 })).toBe(true);
    expect(shouldLock({ enabled: true, lastUnlockedAt: now - 50, now, graceMs: 100 })).toBe(false);
  });

  it('does not unlock itself if the clock jumps backwards', () => {
    // A negative age is "unlocked in the future": inside any window, so it stays unlocked rather
    // than locking at random while the user is mid-entry.
    expect(shouldLock({ enabled: true, lastUnlockedAt: now + 60_000, now })).toBe(false);
  });
});

describe('canUseAppLock', () => {
  afterEach(() => jest.resetAllMocks());

  it('is true only with hardware and something enrolled', async () => {
    mocked.hasHardwareAsync.mockResolvedValue(true);
    mocked.isEnrolledAsync.mockResolvedValue(true);
    await expect(canUseAppLock()).resolves.toBe(true);
  });

  it('is false with hardware but nothing enrolled — the lockout case', async () => {
    mocked.hasHardwareAsync.mockResolvedValue(true);
    mocked.isEnrolledAsync.mockResolvedValue(false);
    await expect(canUseAppLock()).resolves.toBe(false);
  });

  it('is false with no hardware', async () => {
    mocked.hasHardwareAsync.mockResolvedValue(false);
    mocked.isEnrolledAsync.mockResolvedValue(true);
    await expect(canUseAppLock()).resolves.toBe(false);
  });

  it('is false rather than throwing when the platform call fails', async () => {
    mocked.hasHardwareAsync.mockRejectedValue(new Error('no module'));
    mocked.isEnrolledAsync.mockResolvedValue(true);
    await expect(canUseAppLock()).resolves.toBe(false);
  });
});

describe('authenticate', () => {
  afterEach(() => jest.resetAllMocks());

  it('passes the prompt through and reports success', async () => {
    mocked.authenticateAsync.mockResolvedValue({ success: true } as never);
    await expect(authenticate('Unlock mmyway')).resolves.toBe(true);
    expect(mocked.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessage: 'Unlock mmyway', disableDeviceFallback: false }),
    );
  });

  it('reports a cancelled or failed prompt as not unlocked', async () => {
    mocked.authenticateAsync.mockResolvedValue({
      success: false,
      error: 'user_cancel',
    } as never);
    await expect(authenticate('Unlock mmyway')).resolves.toBe(false);
  });

  it('reports a thrown prompt as not unlocked rather than crashing the overlay', async () => {
    mocked.authenticateAsync.mockRejectedValue(new Error('boom'));
    await expect(authenticate('Unlock mmyway')).resolves.toBe(false);
  });
});
