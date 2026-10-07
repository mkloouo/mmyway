import {
  computePlannedNotificationTargets,
  formatPlannedNotificationBody,
  syncPlannedNotifications,
  NOTIFICATION_PREFIX,
} from './notifications';
import { createTestDb } from '../db/testDb';
import { setPlannedNotificationsEnabled } from '../settings/appSettings';
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
    },
  };

  it('computes both 2 days before and day of when both are in the future', () => {
    const now = new Date(2026, 9, 10, 10, 0, 0); // Oct 10, 2026
    const targets = computePlannedNotificationTargets(item, now);

    expect(targets).toHaveLength(2);
    expect(targets[0]?.type).toBe('twoDaysBefore');
    expect(targets[0]?.triggerDate).toEqual(new Date(2026, 9, 13, 14, 30, 0));
    expect(targets[0]?.identifier).toBe(`${NOTIFICATION_PREFIX}netflix:2`);

    expect(targets[1]?.type).toBe('dayOf');
    expect(targets[1]?.triggerDate).toEqual(new Date(2026, 9, 15, 14, 30, 0));
    expect(targets[1]?.identifier).toBe(`${NOTIFICATION_PREFIX}netflix:0`);
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
    expect(targets[0]?.type).toBe('dayOf');
  });

  it('returns empty if both dates are in the past', () => {
    const now = new Date(2026, 9, 16, 10, 0, 0); // Oct 16: both Oct 13 and Oct 15 are past
    const targets = computePlannedNotificationTargets(item, now);

    expect(targets).toHaveLength(0);
  });
});

describe('formatPlannedNotificationBody', () => {
  it('formats dayOf notification with amount', () => {
    const target = {
      identifier: `${NOTIFICATION_PREFIX}netflix:0`,
      type: 'dayOf' as const,
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

  it('formats twoDaysBefore notification with date and amount', () => {
    const target = {
      identifier: `${NOTIFICATION_PREFIX}netflix:2`,
      type: 'twoDaysBefore' as const,
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
          repetitions: [{ type: 'monthly', skip: 0, occurrences: ['2026-10-20'] }],
        }),
        syncedAt,
      },
    ]);

    await syncPlannedNotifications(db, [{ code: 'EUR', symbol: '€' } as any], now);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'planned:gym:2',
        content: expect.objectContaining({
          title: 'Gym',
          data: { plannedKey: 'gym' },
        }),
      }),
    );
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'planned:gym:0',
        content: expect.objectContaining({
          title: 'Gym',
          data: { plannedKey: 'gym' },
        }),
      }),
    );
  });
});
