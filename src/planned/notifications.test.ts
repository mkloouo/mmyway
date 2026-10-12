import {
  computePlannedNotificationTargets,
  formatPlannedNotificationBody,
  matchesReminderFilter,
  planPlannedReminders,
  syncPlannedNotifications,
  NOTIFICATION_PREFIX,
  type PlannedReminderSettings,
  type ReminderItem,
} from './notifications';
import { createTestDb } from '../db/testDb';
import {
  setPlannedNotificationsEnabled,
  setPlannedReminderLead,
  setReminderWhen,
} from '../settings/appSettings';
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

describe('planPlannedReminders', () => {
  const now = new Date(2026, 9, 10, 10, 0, 0); // Oct 10, 2026
  const eur = [{ code: 'EUR', symbol: '€', decimalPlaces: 2 }] as any[];
  const baseSettings: PlannedReminderSettings = {
    when: 'dayBefore',
    overrides: {},
    time: '09:00',
    nudgeOnDay: true,
    filter: 'all',
    minAmount: '200',
    digest: false,
    warnShort: false,
  };
  const itemOf = (
    key: string,
    date: string,
    amount: string,
    extra: Partial<ReminderItem['fields']> = {},
  ): ReminderItem => ({
    key,
    fields: {
      name: key,
      amount,
      currencyCode: 'EUR',
      date,
      time: null,
      type: 'withdrawal',
      ...extra,
    },
  });

  it('uses a per-payment timing over the global one', () => {
    const items = [itemOf('gym', '2026-10-20', '30.00'), itemOf('rent', '2026-10-20', '900.00')];
    const plan = planPlannedReminders(
      items,
      [],
      { ...baseSettings, overrides: { gym: 'week' } },
      eur,
      now,
    );
    const at = (key: string) =>
      plan.filter((r) => r.data.plannedKey === key).map((r) => r.triggerDate);
    // gym: a week ahead (Oct 13) and the day; rent: the global day before (Oct 19) and the day.
    expect(at('gym')).toEqual([new Date(2026, 9, 13, 9), new Date(2026, 9, 20, 9)]);
    expect(at('rent')).toEqual([new Date(2026, 9, 19, 9), new Date(2026, 9, 20, 9)]);
  });

  it('sends nothing for a payment overridden to off', () => {
    const plan = planPlannedReminders(
      [itemOf('gym', '2026-10-20', '30.00')],
      [],
      { ...baseSettings, overrides: { gym: 'off' } },
      eur,
      now,
    );
    expect(plan).toEqual([]);
  });

  it('fires at the reminder time for a payment with no time of its own, and its own time otherwise', () => {
    const items = [
      itemOf('gym', '2026-10-20', '30.00'),
      itemOf('rent', '2026-10-20', '900.00', { time: '14:30' }),
    ];
    const plan = planPlannedReminders(items, [], { ...baseSettings, time: '07:30' }, eur, now);
    const at = (key: string) =>
      plan.filter((r) => r.data.plannedKey === key).map((r) => r.triggerDate);
    expect(at('gym')).toEqual([new Date(2026, 9, 19, 7, 30), new Date(2026, 9, 20, 7, 30)]);
    expect(at('rent')).toEqual([new Date(2026, 9, 19, 14, 30), new Date(2026, 9, 20, 14, 30)]);
  });

  it('leaves out the on-the-day reminder when nudge is off', () => {
    const plan = planPlannedReminders(
      [itemOf('gym', '2026-10-20', '30.00')],
      [],
      { ...baseSettings, nudgeOnDay: false },
      eur,
      now,
    );
    expect(plan.map((r) => r.triggerDate)).toEqual([new Date(2026, 9, 19, 9)]);
  });

  it('keeps only withdrawals for outgoing, and amounts at least the minimum for bigger', () => {
    const items = [
      itemOf('small', '2026-10-20', '15.99'),
      itemOf('big', '2026-10-20', '350.00'),
      itemOf('salary', '2026-10-20', '2000.00', { type: 'deposit' }),
    ];
    const keys = (filter: PlannedReminderSettings['filter'], minAmount = '200') => [
      ...new Set(
        planPlannedReminders(items, [], { ...baseSettings, filter, minAmount }, eur, now).map(
          (r) => r.data.plannedKey,
        ),
      ),
    ];
    expect(keys('all')).toEqual(['small', 'big', 'salary']);
    expect(keys('outgoing')).toEqual(['small', 'big']);
    expect(keys('bigger')).toEqual(['big', 'salary']);
    expect(keys('bigger', '400')).toEqual(['salary']);
    expect(matchesReminderFilter({ amount: '-350.00' }, 'bigger', '200')).toBe(true);
  });

  it('groups three payments due the same day into one digest with the total', () => {
    const items = [
      itemOf('a', '2026-10-20', '10.00'),
      itemOf('b', '2026-10-20', '20.00'),
      itemOf('c', '2026-10-20', '30.00'),
    ];
    const plan = planPlannedReminders(items, [], { ...baseSettings, digest: true }, eur, now);
    // One digest the day before (lead) and one on the day (nudge), not six notifications.
    expect(plan).toHaveLength(2);
    const lead = plan.find((r) => r.triggerDate.getTime() === new Date(2026, 9, 19, 9).getTime())!;
    expect(lead.identifier).toMatch(new RegExp(`^${NOTIFICATION_PREFIX}digest:`));
    expect(lead.title).toContain('3 payments tomorrow');
    expect(lead.title).toMatch(/60[.,]00/);
    expect(lead.body).toBe('a, b, c');
    expect(lead.categoryIdentifier).toBeUndefined();
  });

  it('warns the day before when an outgoing payment exceeds what the account has left', () => {
    const accounts = [
      { id: 'acc1', name: 'Current', currencyCode: 'EUR', currentBalance: '100.00' },
    ];
    const items = [
      itemOf('a', '2026-10-18', '80.00', { sourceId: 'acc1' }),
      itemOf('b', '2026-10-20', '80.00', { sourceId: 'acc1' }),
    ];
    const plan = planPlannedReminders(
      items,
      accounts,
      { ...baseSettings, warnShort: true },
      eur,
      now,
    );
    // The first one is covered (100 - 80 = 20 left), the second is not (80 > 20).
    const warnings = plan.filter((r) => r.categoryIdentifier === 'planned-short');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.triggerDate).toEqual(new Date(2026, 9, 19, 9));
    expect(warnings[0]?.identifier).toBe(`${NOTIFICATION_PREFIX}short:acc1:2026-10-20:b`);
    expect(warnings[0]?.data).toEqual({
      plannedKey: 'b',
      dueDate: '2026-10-20',
      accountId: 'acc1',
    });
    const covered = plan.filter((r) => r.data.plannedKey === 'a');
    expect(covered.every((r) => r.body.includes('enough in it'))).toBe(true);
  });
});

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
    await setReminderWhen(db, 'fewDays'); // the lead this test asserts: 2 days before, then the day
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
          data: { plannedKey: 'gym', dueDate: '2026-10-20' },
        }),
      }),
    );
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'planned:gym:2026-10-20:0',
        content: expect.objectContaining({
          title: 'Gym',
          data: { plannedKey: 'gym', dueDate: '2026-10-20' },
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
