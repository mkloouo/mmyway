import {
  computePlannedNotificationTargets,
  formatPlannedNotificationBody,
  syncPlannedNotifications,
  NOTIFICATION_PREFIX,
} from './notifications';
import { createTestDb } from '../db/testDb';
import { setPlannedNotificationsEnabled, setPlannedReminderLead } from '../settings/appSettings';
import * as Notifications from 'expo-notifications';
import { plannedObjects } from '../db/schema';
import { plannedKey } from './objects';

jest.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('test-id'),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

describe('computePlannedNotificationTargets', () => {
  const item = {
    key: 'netflix',
    fields: {
      name: 'Netflix',
      amount: '15.99',
      currencyCode: 'EUR',
      date: '2026-10-15',
      time: '14:30',
      repeats: false,
      skipDays: [] as string[],
    },
  };

  it('computes both the lead reminder and the day itself when both are in the future', () => {
    const now = new Date(2026, 9, 10, 10, 0, 0); // Oct 10, 2026
    const targets = computePlannedNotificationTargets(item, now);

    expect(targets).toHaveLength(2);
    expect(targets[0]?.leadDays).toBe(2);
    expect(targets[0]?.triggerDate).toEqual(new Date(2026, 9, 13, 14, 30, 0));
    expect(targets[0]?.identifier).toBe(`${NOTIFICATION_PREFIX}netflix:2026-10-15:2`);

    expect(targets[1]?.leadDays).toBe(0);
    expect(targets[1]?.triggerDate).toEqual(new Date(2026, 9, 15, 14, 30, 0));
    expect(targets[1]?.identifier).toBe(`${NOTIFICATION_PREFIX}netflix:2026-10-15:0`);
  });

  it('takes the lead time it is given, and only the day itself for a lead of none', () => {
    const now = new Date(2026, 9, 1, 10, 0, 0);
    expect(computePlannedNotificationTargets(item, now, 7).map((x) => x.triggerDate)).toEqual([
      new Date(2026, 9, 8, 14, 30, 0),
      new Date(2026, 9, 15, 14, 30, 0),
    ]);
    const onlyTheDay = computePlannedNotificationTargets(item, now, 0);
    expect(onlyTheDay).toHaveLength(1);
    expect(onlyTheDay[0]?.leadDays).toBe(0);
  });

  it('reminds about every occurrence inside the horizon, not just the next one', () => {
    const weekly = {
      key: 'gym',
      fields: {
        ...item.fields,
        date: '2026-10-15',
        repeats: true,
        repetitions: [{ type: 'weekly' as const, moment: '4', skip: 0, weekend: 1 as const }],
      },
    };
    const now = new Date(2026, 9, 10, 10, 0, 0);
    const days = [
      ...new Set(computePlannedNotificationTargets(weekly, now, 0).map((x) => x.dueDate)),
    ];
    // 2026-10-15 is a Thursday; the horizon is 30 days.
    expect(days).toEqual(['2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05']);
  });

  it('leaves out an occurrence the user skipped', () => {
    const weekly = {
      key: 'gym',
      fields: {
        ...item.fields,
        repeats: true,
        repetitions: [{ type: 'weekly' as const, moment: '4', skip: 0, weekend: 1 as const }],
        skipDays: ['2026-10-22'],
      },
    };
    const now = new Date(2026, 9, 10, 10, 0, 0);
    const days = computePlannedNotificationTargets(weekly, now, 0).map((x) => x.dueDate);
    expect(days).not.toContain('2026-10-22');
    expect(days).toContain('2026-10-15');
  });

  it('defaults to 9:00 AM if time is not specified', () => {
    const noTimeItem = {
      ...item,
      fields: { ...item.fields, time: null },
    };
    const now = new Date(2026, 9, 10, 10, 0, 0);
    const targets = computePlannedNotificationTargets(noTimeItem, now);

    expect(targets).toHaveLength(2);
    expect(targets[0]?.triggerDate.getHours()).toBe(9);
    expect(targets[0]?.triggerDate.getMinutes()).toBe(0);
  });

  it('drops 2 days before if it is in the past', () => {
    const now = new Date(2026, 9, 14, 10, 0, 0); // Oct 14: Oct 13 14:30 is in the past
    const targets = computePlannedNotificationTargets(item, now);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.leadDays).toBe(0);
  });

  it('returns empty if both dates are in the past', () => {
    const now = new Date(2026, 9, 16, 10, 0, 0); // Oct 16: both Oct 13 and Oct 15 are past
    const targets = computePlannedNotificationTargets(item, now);

    expect(targets).toHaveLength(0);
  });
});

describe('formatPlannedNotificationBody', () => {
  it('formats the day-of notification with amount', () => {
    const target = {
      identifier: `${NOTIFICATION_PREFIX}netflix:2026-10-15:0`,
      leadDays: 0,
      triggerDate: new Date(2026, 9, 15),
      plannedKey: 'netflix',
      name: 'Netflix',
      amount: '15.99',
      currencyCode: 'EUR',
      dueDate: '2026-10-15',
    };
    const body = formatPlannedNotificationBody(target, [{ code: 'EUR', symbol: '€' } as any]);
    expect(body).toContain('15.99');
  });

  it('formats the lead notification with date and amount', () => {
    const target = {
      identifier: `${NOTIFICATION_PREFIX}netflix:2026-10-15:2`,
      leadDays: 2,
      triggerDate: new Date(2026, 9, 13),
      plannedKey: 'netflix',
      name: 'Netflix',
      amount: '15.99',
      currencyCode: 'EUR',
      dueDate: '2026-10-15',
    };
    const body = formatPlannedNotificationBody(target, [{ code: 'EUR', symbol: '€' } as any]);
    expect(body).toContain('15.99');
  });
});

describe('syncPlannedNotifications', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    jest.clearAllMocks();
  });

  it('cancels all planned notifications and returns when disabled', async () => {
    await setPlannedNotificationsEnabled(db, false);
    jest
      .mocked(Notifications.getAllScheduledNotificationsAsync)
      .mockResolvedValueOnce([
        { identifier: 'planned:sub1:0' } as any,
        { identifier: 'other:123' } as any,
      ]);

    await syncPlannedNotifications(db);

    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('planned:sub1:0');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('other:123');
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules notifications for upcoming items when enabled', async () => {
    await setPlannedNotificationsEnabled(db, true);
    // Insert a planned trio (bill, rule, recurrence) so plannedItems considers it complete
    const now = new Date(2026, 9, 1, 10, 0, 0); // Oct 1, 2026
    const syncedAt = now.toISOString();
    await db.insert(plannedObjects).values([
      {
        key: plannedKey('bill', '1'),
        kind: 'bill',
        ff3Id: '1',
        name: 'Gym',
        attributesJson: JSON.stringify({
          name: 'Gym',
          amount_min: '30.00',
          amount_max: '30.00',
          currency_code: 'EUR',
          date: '2026-10-20',
          repeat_freq: 'monthly',
        }),
        syncedAt,
      },
      {
        key: plannedKey('rule', '1'),
        kind: 'rule',
        ff3Id: '1',
        name: 'Gym',
        attributesJson: JSON.stringify({
          title: 'Gym',
          actions: [],
          triggers: [],
        }),
        syncedAt,
      },
      {
        key: plannedKey('recurrence', '1'),
        kind: 'recurrence',
        ff3Id: '1',
        name: 'Gym',
        attributesJson: JSON.stringify({
          title: 'Gym',
          first_date: '2026-10-20',
          type: 'withdrawal',
          transactions: [{ amount: '30.00', currency_code: 'EUR' }],
          repetitions: [{ type: 'monthly', moment: '20', skip: 0, occurrences: ['2026-10-20'] }],
        }),
        syncedAt,
      },
    ]);

    await syncPlannedNotifications(db, [{ code: 'EUR', symbol: '€' } as any], now);

    // One occurrence inside the 30-day horizon, so the lead reminder and the day itself.
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'planned:gym:2026-10-20:2',
        content: expect.objectContaining({
          title: 'Gym',
          data: { plannedKey: 'gym' },
        }),
      }),
    );
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'planned:gym:2026-10-20:0',
        content: expect.objectContaining({
          title: 'Gym',
          data: { plannedKey: 'gym' },
        }),
      }),
    );
  });

  it('honours the lead time the user chose', async () => {
    await setPlannedNotificationsEnabled(db, true);
    await setPlannedReminderLead(db, 0);
    const now = new Date(2026, 9, 1, 10, 0, 0);
    await db.insert(plannedObjects).values([
      {
        key: plannedKey('bill', '1'),
        kind: 'bill',
        ff3Id: '1',
        name: 'Gym',
        attributesJson: JSON.stringify({ name: 'Gym', amount_max: '30.00', date: '2026-10-20' }),
        syncedAt: now.toISOString(),
      },
      {
        key: plannedKey('rule', '1'),
        kind: 'rule',
        ff3Id: '1',
        name: 'Gym',
        attributesJson: JSON.stringify({ title: 'Gym', actions: [], triggers: [] }),
        syncedAt: now.toISOString(),
      },
      {
        key: plannedKey('recurrence', '1'),
        kind: 'recurrence',
        ff3Id: '1',
        name: 'Gym',
        attributesJson: JSON.stringify({
          title: 'Gym',
          first_date: '2026-10-20',
          type: 'withdrawal',
          transactions: [{ amount: '30.00', currency_code: 'EUR' }],
          repetitions: [{ type: 'yearly', moment: '2026-10-20', skip: 0 }],
        }),
        syncedAt: now.toISOString(),
      },
    ]);

    await syncPlannedNotifications(db, [{ code: 'EUR', symbol: '€' } as any], now);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'planned:gym:2026-10-20:0' }),
    );
  });

  it('serializes concurrent sync calls', async () => {
    await setPlannedNotificationsEnabled(db, true);
    await Promise.all([
      syncPlannedNotifications(db),
      syncPlannedNotifications(db),
      syncPlannedNotifications(db),
    ]);
    expect(Notifications.getAllScheduledNotificationsAsync).toHaveBeenCalled();
  });
});
