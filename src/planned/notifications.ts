// Local reminders for planned transactions: on the day of the planned transaction and 2 days before.
import { inArray } from 'drizzle-orm';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { outboxOperations, plannedObjects, referenceCurrencies } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';
import { plannedItems } from './items';
import { readPlannedRow, type PlannedObject } from './objects';
import { getPlannedNotificationsEnabled } from '../settings/appSettings';
import { localDay } from '../utils/day';
import { logLine } from '../utils/log';
import { errorMessage } from '../utils/errorMessage';
import i18n, { appLocale } from '../i18n';
import { currencyOf, formatMoney } from '../ui/money';

type Currencies = (typeof referenceCurrencies.$inferSelect)[];

const PLANNED_NOTIFICATION_CHANNEL_ID = 'planned-transactions';
export const NOTIFICATION_PREFIX = 'planned:';

interface PlannedNotificationTarget {
  identifier: string;
  type: 'twoDaysBefore' | 'dayOf';
  triggerDate: Date;
  plannedKey: string;
  name: string;
  amount: string;
  currencyCode: string;
  dueDate: string;
}

/**
 * Computes scheduled reminders for a planned transaction:
 * - 2 days before the due date (at the planned time or 9:00 AM)
 * - On the day of the planned transaction (at the planned time or 9:00 AM)
 * Only future targets are returned.
 */
export function computePlannedNotificationTargets(
  item: {
    key: string;
    fields: {
      name: string;
      amount: string;
      currencyCode: string;
      date: string;
      time: string | null;
    };
  },
  now = new Date(),
): PlannedNotificationTarget[] {
  const parts = item.fields.date.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (!year || !month || !day) return [];

  let hour = 9;
  let minute = 0;
  if (item.fields.time) {
    const timeParts = item.fields.time.split(':').map(Number);
    if (timeParts.length >= 2 && !isNaN(timeParts[0]!) && !isNaN(timeParts[1]!)) {
      hour = timeParts[0]!;
      minute = timeParts[1]!;
    }
  }

  const dayOf = new Date(year, month - 1, day, hour, minute, 0, 0);
  const twoDaysBefore = new Date(year, month - 1, day - 2, hour, minute, 0, 0);

  const targets: PlannedNotificationTarget[] = [];
  const nowMs = now.getTime();

  if (twoDaysBefore.getTime() > nowMs) {
    targets.push({
      identifier: `${NOTIFICATION_PREFIX}${item.key}:2`,
      type: 'twoDaysBefore',
      triggerDate: twoDaysBefore,
      plannedKey: item.key,
      name: item.fields.name,
      amount: item.fields.amount,
      currencyCode: item.fields.currencyCode,
      dueDate: item.fields.date,
    });
  }

  if (dayOf.getTime() > nowMs) {
    targets.push({
      identifier: `${NOTIFICATION_PREFIX}${item.key}:0`,
      type: 'dayOf',
      triggerDate: dayOf,
      plannedKey: item.key,
      name: item.fields.name,
      amount: item.fields.amount,
      currencyCode: item.fields.currencyCode,
      dueDate: item.fields.date,
    });
  }

  return targets;
}

export function formatPlannedNotificationBody(
  target: PlannedNotificationTarget,
  currencies: Currencies = [],
): string {
  const currency = currencyOf(currencies, target.currencyCode);
  const hasAmount = target.amount && target.amount !== '0';
  const formattedAmount = hasAmount ? formatMoney(target.amount, currency) : '';

  if (target.type === 'dayOf') {
    return formattedAmount
      ? i18n.t('planned.notificationToday', { amount: formattedAmount })
      : i18n.t('planned.notificationTodayNoAmount');
  }

  const parts = target.dueDate.split('-').map(Number);
  const dueDateObj = new Date(parts[0]!, parts[1]! - 1, parts[2]!);
  const formattedDate = dueDateObj.toLocaleDateString(appLocale(), {
    month: 'short',
    day: 'numeric',
  });

  return formattedAmount
    ? i18n.t('planned.notificationTwoDays', { date: formattedDate, amount: formattedAmount })
    : i18n.t('planned.notificationTwoDaysNoAmount', { date: formattedDate });
}

async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(PLANNED_NOTIFICATION_CHANNEL_ID, {
      name: i18n.t('planned.notificationChannelName', { defaultValue: 'Planned transactions' }),
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#3746BB',
    });
  }
}

async function cancelPlannedNotifications(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const planned = scheduled.filter((n) => n.identifier.startsWith(NOTIFICATION_PREFIX));
    if (planned.length === 0) return;
    await Promise.all(
      planned.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
  } catch (err) {
    logLine('warn', `could not cancel planned notifications: ${errorMessage(err)}`);
  }
}

async function doSyncPlannedNotifications(
  db: OutboxDb,
  currencies: Currencies = [],
  now = new Date(),
): Promise<void> {
  try {
    const enabled = await getPlannedNotificationsEnabled(db);
    if (!enabled) {
      await cancelPlannedNotifications();
      return;
    }

    await cancelPlannedNotifications();
    await setupNotificationChannel();

    const rows = await db.select().from(plannedObjects);
    const ops = await db
      .select()
      .from(outboxOperations)
      .where(inArray(outboxOperations.kind, ['save_planned', 'delete_planned']));
    const objects = rows.map(readPlannedRow).filter((o): o is PlannedObject => !!o);
    const items = plannedItems(objects, ops, localDay(now));

    const resolvedCurrencies =
      currencies && currencies.length > 0
        ? currencies
        : await db.select().from(referenceCurrencies);

    for (const item of items) {
      const targets = computePlannedNotificationTargets(item, now);
      for (const target of targets) {
        const body = formatPlannedNotificationBody(target, resolvedCurrencies);
        await Notifications.scheduleNotificationAsync({
          identifier: target.identifier,
          content: {
            title: target.name,
            body,
            data: { plannedKey: target.plannedKey },
          },
          trigger: {
            type: SchedulableTriggerInputTypes.DATE,
            date: target.triggerDate,
            channelId: PLANNED_NOTIFICATION_CHANNEL_ID,
          },
        });
      }
    }
  } catch (err) {
    logLine('warn', `could not sync planned notifications: ${errorMessage(err)}`);
  }
}

let inFlightSync: Promise<void> | null = null;
let queuedRerun: { db: OutboxDb; currencies: Currencies; now: Date } | null = null;

export async function syncPlannedNotifications(
  db: OutboxDb,
  currencies: Currencies = [],
  now = new Date(),
): Promise<void> {
  if (inFlightSync) {
    queuedRerun = { db, currencies, now };
    return inFlightSync;
  }
  inFlightSync = (async () => {
    try {
      await doSyncPlannedNotifications(db, currencies, now);
      while (queuedRerun) {
        const next = queuedRerun;
        queuedRerun = null;
        await doSyncPlannedNotifications(next.db, next.currencies, next.now);
      }
    } finally {
      inFlightSync = null;
    }
  })();
  return inFlightSync;
}
