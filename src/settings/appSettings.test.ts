import { createTestDb } from '../db/testDb';
import { appSettings } from '../db/schema';
import {
  getDefaultSourceAccountId,
  setDefaultSourceAccountId,
  getLocalModelBaseUrl,
  setLocalModelBaseUrl,
  getLocalModelBaseUrls,
  setLocalModelBaseUrls,
  parseAccountOrder,
  getUseServerTime,
  setUseServerTime,
  getPlannedReminderLead,
  setPlannedReminderLead,
  getReminderWhen,
  setReminderWhen,
  getReminderTime,
  setReminderTime,
  getReminderNudgeOnDay,
  getReminderFilter,
  setReminderFilter,
  getReminderMinAmount,
  setReminderMinAmount,
  getReminderDigest,
  getReminderWarnShort,
  getReminderOverrides,
  setReminderOverride,
  getReminderPromptShown,
  getReceiptReader,
  setReceiptReader,
} from './appSettings';

describe('receipt reader setting', () => {
  it('defaults to auto (local model, then Gemini) when never chosen', async () => {
    const db = createTestDb();
    expect(await getReceiptReader(db as any)).toBe('auto');
  });

  it('round-trips each option through set then get', async () => {
    const db = createTestDb();
    for (const reader of ['none', 'local', 'auto'] as const) {
      await setReceiptReader(db as any, reader);
      expect(await getReceiptReader(db as any)).toBe(reader);
    }
  });

  it('reads an unknown stored value as the default', async () => {
    const db = createTestDb();
    await db
      .insert(appSettings)
      .values({ key: 'receipt_reader', value: 'gemini-only' })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: 'gemini-only' } });
    expect(await getReceiptReader(db as any)).toBe('auto');
  });
});

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

  it('reads the reminder timing from the lead key and writes it back', async () => {
    const db = createTestDb() as any;
    expect(await getReminderWhen(db)).toBe('fewDays'); // the old default lead, 2;
    await setPlannedReminderLead(db, 7);
    expect(await getReminderWhen(db)).toBe('week');
    await setReminderWhen(db, 'fewDays');
    expect(await getPlannedReminderLead(db)).toBe(2);
    expect(await getReminderWhen(db)).toBe('fewDays');
  });

  it('keeps a valid reminder time and falls back to 09:00 otherwise', async () => {
    const db = createTestDb() as any;
    expect(await getReminderTime(db)).toBe('09:00');
    await setReminderTime(db, '07:45');
    expect(await getReminderTime(db)).toBe('07:45');
    expect(() => setReminderTime(db, '7:45')).toThrow();
  });

  it('defaults the reminder options and round-trips them', async () => {
    const db = createTestDb() as any;
    expect(await getReminderNudgeOnDay(db)).toBe(true);
    expect(await getReminderFilter(db)).toBe('all');
    expect(await getReminderDigest(db)).toBe(false);
    expect(await getReminderWarnShort(db)).toBe(true);
    expect(await getReminderPromptShown(db)).toBe(false);
    await setReminderFilter(db, 'bigger');
    expect(await getReminderFilter(db)).toBe('bigger');
  });

  it('keeps the minimum amount as a decimal string, and rejects a bad one', async () => {
    const db = createTestDb() as any;
    expect(await getReminderMinAmount(db)).toBe('200');
    await setReminderMinAmount(db, '1 250,5');
    expect(await getReminderMinAmount(db)).toBe('1250.5');
    await expect(setReminderMinAmount(db, 'lots')).rejects.toThrow();
  });

  it('stores per-payment overrides, removes one on null, and reads bad JSON as none', async () => {
    const db = createTestDb() as any;
    await setReminderOverride(db, 'gym', 'off');
    await setReminderOverride(db, 'rent', 'week');
    expect(await getReminderOverrides(db)).toEqual({ gym: 'off', rent: 'week' });
    await setReminderOverride(db, 'gym', null);
    expect(await getReminderOverrides(db)).toEqual({ rent: 'week' });
    await db
      .insert(appSettings)
      .values({ key: 'planned_reminder_overrides', value: '{not json' })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: '{not json' } });
    expect(await getReminderOverrides(db)).toEqual({});
  });

  it('reads well-formed and malformed accountOrder and localModelBaseUrls safely', async () => {
    const db = createTestDb() as any;
    expect(parseAccountOrder('{"acc1": 1, "acc2": 2}')).toEqual({ acc1: 1, acc2: 2 });
    expect(parseAccountOrder('{broken json')).toEqual({});
    expect(parseAccountOrder(JSON.stringify(['not', 'an', 'object']))).toEqual({});

    await setLocalModelBaseUrls(db, ['https://model1.local', 'https://model2.local']);
    expect(await getLocalModelBaseUrls(db)).toEqual([
      'https://model1.local',
      'https://model2.local',
    ]);

    await db
      .insert(appSettings)
      .values({ key: 'local_model_base_urls', value: '{"not": "an array"}' })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: '{"not": "an array"}' },
      });
    expect(await getLocalModelBaseUrls(db)).toEqual([]);
  });
});
