import { createTestDb } from '../db/testDb';
import {
  getDefaultSourceAccountId,
  setDefaultSourceAccountId,
  getLocalModelBaseUrl,
  setLocalModelBaseUrl,
  getUseServerTime,
  setUseServerTime,
} from './appSettings';

describe('appSettings', () => {
  it('returns null for a setting that was never written', async () => {
    const db = createTestDb();
    expect(await getDefaultSourceAccountId(db as any)).toBeNull();
    expect(await getUseServerTime(db as any)).toBe(false);
  });

  it('round-trips a value through set then get', async () => {
    const db = createTestDb();
    await setDefaultSourceAccountId(db as any, 'acc-1');
    expect(await getDefaultSourceAccountId(db as any)).toBe('acc-1');
  });

  it('overwrites on a second set instead of erroring', async () => {
    const db = createTestDb();
    await setLocalModelBaseUrl(db as any, 'http://localhost:1234');
    await setLocalModelBaseUrl(db as any, 'http://localhost:5678');
    expect(await getLocalModelBaseUrl(db as any)).toBe('http://localhost:5678');
  });

  it('stores the use-server-time flag as a boolean', async () => {
    const db = createTestDb();
    await setUseServerTime(db as any, true);
    expect(await getUseServerTime(db as any)).toBe(true);
    await setUseServerTime(db as any, false);
    expect(await getUseServerTime(db as any)).toBe(false);
  });
});
