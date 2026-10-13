import { createTestDb } from '../db/testDb';
import { setFlagOverrides } from '../settings/appSettings';
import {
  forgetPosition,
  freshPosition,
  recentPosition,
  roundPosition,
  startPositionRequest,
} from './position';

// `mock`-prefixed so Jest's hoisting lets the factory below close over them. position.ts requires
// expo-location lazily, so this mock is the one it gets.
const mockRequestPermission = jest.fn();
const mockGetCurrentPosition = jest.fn();
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestPermission(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPosition(...args),
  Accuracy: { Balanced: 3 },
}));

describe('a position fix', () => {
  const here = { latitude: 52.2297, longitude: 21.0122 };

  it('is rounded to five decimals, a few metres, with the accuracy kept whole', () => {
    expect(
      roundPosition({ latitude: 52.2297123456, longitude: 21.0122987654, accuracy: 23.7 }),
    ).toEqual({ latitude: 52.22971, longitude: 21.0123, accuracyM: 24 });
  });

  it('leaves out an accuracy the phone did not report', () => {
    expect(roundPosition({ latitude: 52.2297, longitude: 21.0122, accuracy: null })).toEqual(here);
  });

  it('stands in for "here" for ten minutes, and no longer', () => {
    const now = 1_700_000_000_000;
    expect(freshPosition({ at: now - 60_000, position: here }, now)).toEqual(here);
    expect(freshPosition({ at: now - 11 * 60_000, position: here }, now)).toBeUndefined();
    expect(freshPosition(null, now)).toBeUndefined();
  });
});

describe('a position request with record_location', () => {
  // The request is all microtasks under Jest, so one macrotask turn lets it finish.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    forgetPosition();
    jest.clearAllMocks();
    mockRequestPermission.mockResolvedValue({ status: 'granted' });
    mockGetCurrentPosition.mockResolvedValue({
      coords: { latitude: 52.2297, longitude: 21.0122, accuracy: 10 },
    });
  });

  it('asks for a fix when the flag is on', async () => {
    await setFlagOverrides(db, { record_location: true });

    startPositionRequest(db);
    await settle();

    expect(mockRequestPermission).toHaveBeenCalled();
    expect(recentPosition()).toEqual({ latitude: 52.2297, longitude: 21.0122, accuracyM: 10 });
  });

  it('asks for nothing and holds no fix while the flag is off', async () => {
    startPositionRequest(db);
    await settle();

    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
    expect(recentPosition()).toBeUndefined();
  });

  it('drops a fix it already holds once the flag is turned off', async () => {
    await setFlagOverrides(db, { record_location: true });
    startPositionRequest(db);
    await settle();

    await setFlagOverrides(db, { record_location: false });
    startPositionRequest(db);
    await settle();

    expect(recentPosition()).toBeUndefined();
  });
});
