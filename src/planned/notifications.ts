// Local reminders for planned transactions: on the day of each upcoming occurrence, and a chosen
// number of days before it.
//
// The dates come from the occurrence list (src/planned/occurrences.ts), not from the single "next"
// date, so a weekly or daily planned transaction is reminded about more than once — bounded by
// HORIZON_DAYS, because Android throttles large numbers of pending alarms and the whole set is
// cancelled and rebuilt on every change anyway. Occurrences the user skipped are left out.
import { inArray } from 'drizzle-orm';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { outboxOperations, plannedObjects, referenceCurrencies } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';
import { plannedItems } from './items';
import { readPlannedRow, type PlannedObject } from './objects';
import type { Repetition } from './repetition';
import {
  DEFAULT_PLANNED_REMINDER_LEAD,
  getPlannedNotificationsEnabled,
  getPlannedReminderLead,
} from '../settings/appSettings';
import { upcomingOccurrences } from './occurrences';
import { localDay } from '../utils/day';
import { logLine } from '../utils/log';
import { errorMessage } from '../utils/errorMessage';
import i18n, { appLocale } from '../i18n';
import { currencyOf, formatMoney } from '../ui/money';

type Currencies = (typeof referenceCurrencies.$inferSelect)[];

const PLANNED_NOTIFICATION_CHANNEL_ID = 'planned-transactions';
export const NOTIFICATION_PREFIX = 'planned:';

/** How far ahead reminders are scheduled. Rebuilt on every sync, so this only bounds the alarms. */
const HORIZON_DAYS = 30;
/** At most this many occurrences per planned transaction, so a daily one cannot flood the list. */
const MAX_PER_ITEM = 8;

interface PlannedNotificationTarget {
  identifier: string;
  /** 0 on the day itself, otherwise how many days before the occurrence. */
  leadDays: number;
  triggerDate: Date;
  plannedKey: string;
  name: string;
  amount: string;
  currencyCode: string;
  dueDate: string;
}

/**
 * The reminders for one planned transaction: on the day of each upcoming occurrence, and
 * `leadDays` before it, at the planned time or 09:00. Only future ones, only within the horizon.
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
      repeats?: boolean;
      repetitions?: Repetition[];
      skipDays?: string[];
    };
  },
  now = new Date(),
  leadDays = DEFAULT_PLANNED_REMINDER_LEAD,
): PlannedNotificationTarget[] {
  const f = item.fields;
  let hour = 9;
  let minute = 0;
  if (f.time) {
    const [h, m] = f.time.split(':').map(Number);
    if (Number.isInteger(h) && Number.isInteger(m) && h! <= 23 && m! <= 59) {
      hour = h!;
      minute = m!;
    }
  }

  const today = localDay(now);
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + HORIZON_DAYS);
  const from = f.date > today ? f.date : today;
  const days =
    f.repeats && f.repetitions?.length
      ? upcomingOccurrences(f.repetitions, from, {
          count: MAX_PER_ITEM,
          until: localDay(horizon),
          skipDays: f.skipDays,
        })
      : [f.date].filter((d) => d >= today && d <= localDay(horizon) && !f.skipDays?.includes(d));

  const targets: PlannedNotificationTarget[] = [];
  for (const day of days) {
    const [year, month, date] = day.split('-').map(Number);
    if (!year || !month || !date) continue;
    // The lead reminder first, so the day's own one is the last thing scheduled for that date.
    for (const lead of leadDays > 0 ? [leadDays, 0] : [0]) {
      const at = new Date(year, month - 1, date - lead, hour, minute, 0, 0);
      if (at.getTime() <= now.getTime()) continue;
      targets.push({
        identifier: `${NOTIFICATION_PREFIX}${item.key}:${day}:${lead}`,
        leadDays: lead,
        triggerDate: at,
        plannedKey: item.key,
        name: f.name,
        amount: f.amount,
        currencyCode: f.currencyCode,
        dueDate: day,
      });
    }
  }
  return targets;
}

export function formatPlannedNotificationBody(
  target: PlannedNotificationTarget,
  currencies: Currencies = [],
): string {
  const currency = currencyOf(currencies, target.currencyCode);
  const hasAmount = target.amount && target.amount !== '0';
  const amount = hasAmount ? formatMoney(target.amount, currency) : '';

  if (target.leadDays === 0)
    return amount
      ? i18n.t('planned.notificationToday', { amount })
      : i18n.t('planned.notificationTodayNoAmount');

  const parts = target.dueDate.split('-').map(Number);
  const due = new Date(parts[0]!, parts[1]! - 1, parts[2]!);
  const date = due.toLocaleDateString(appLocale(), { month: 'short', day: 'numeric' });
  return amount
    ? i18n.t('planned.notificationAhead', { count: target.leadDays, date, amount })
    : i18n.t('planned.notificationAheadNoAmount', { count: target.leadDays, date });
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

    const leadDays = await getPlannedReminderLead(db);
    const resolvedCurrencies =
      currencies && currencies.length > 0
        ? currencies
        : await db.select().from(referenceCurrencies);

    for (const item of items) {
      const targets = computePlannedNotificationTargets(item, now, leadDays);
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
