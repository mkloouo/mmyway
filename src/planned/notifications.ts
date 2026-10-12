// Local reminders for planned transactions: on the day of each upcoming occurrence, and a chosen
// number of days before it, at the planned time (or the reminder time when there is none).
//
// The dates come from the occurrence list (src/planned/occurrences.ts), not from the single "next"
// date, so a weekly or daily planned transaction is reminded about more than once — bounded by
// HORIZON_DAYS, because Android throttles large numbers of pending alarms and the whole set is
// cancelled and rebuilt on every change anyway. Occurrences the user skipped are left out.
//
// planPlannedReminders is the pure core: it decides every notification (reminders, digests and
// "may run short" warnings) from the items, the account balances and the settings. The sync only
// cancels and schedules what it returns.
import { inArray } from 'drizzle-orm';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import {
  outboxOperations,
  plannedObjects,
  referenceAccounts,
  referenceCurrencies,
} from '../db/schema';
import type { OutboxDb } from '../sync/outbox';
import { plannedItems } from './items';
import { readPlannedRow, type PlannedObject } from './objects';
import type { PlannedFields } from './model';
import type { Repetition } from './repetition';
import {
  DEFAULT_PLANNED_REMINDER_LEAD,
  REMINDER_WHEN_LEAD,
  getPlannedNotificationsEnabled,
  getReminderDigest,
  getReminderFilter,
  getReminderMinAmount,
  getReminderNudgeOnDay,
  getReminderOverrides,
  getReminderTime,
  getReminderWarnShort,
  getReminderWhen,
  type ReminderFilter,
  type ReminderWhen,
} from '../settings/appSettings';
import { upcomingOccurrences } from './occurrences';
import { localDay } from '../utils/day';
import { logLine } from '../utils/log';
import { errorMessage } from '../utils/errorMessage';
import i18n, { appLocale } from '../i18n';
import { currencyOf, formatMoney } from '../ui/money';
import { addDecimal, compareDecimal, subtractDecimal } from '../api/ff3/decimal';

type Currencies = (typeof referenceCurrencies.$inferSelect)[];
type AccountRow = Pick<
  typeof referenceAccounts.$inferSelect,
  'id' | 'name' | 'currencyCode' | 'currentBalance'
>;

const PLANNED_NOTIFICATION_CHANNEL_ID = 'planned-transactions';
export const NOTIFICATION_PREFIX = 'planned:';

/** How far ahead reminders are scheduled. Rebuilt on every sync, so this only bounds the alarms. */
const HORIZON_DAYS = 30;
/** At most this many occurrences per planned transaction, so a daily one cannot flood the list. */
const MAX_PER_ITEM = 8;
const FALLBACK_CLOCK = { hour: 9, minute: 0 };

interface Clock {
  hour: number;
  minute: number;
}

/** The fields the reminders read. A planned item from src/planned/items.ts satisfies this. */
export interface ReminderItem {
  key: string;
  fields: {
    name: string;
    amount: string;
    currencyCode: string;
    date: string;
    time: string | null;
    type?: PlannedFields['type'];
    sourceId?: string | null;
    repeats?: boolean;
    repetitions?: Repetition[];
    skipDays?: string[];
  };
}

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

export interface PlannedReminderSettings {
  /** The global timing; a per-payment override replaces it. */
  when: ReminderWhen;
  overrides: Record<string, ReminderWhen | 'off'>;
  /** HH:MM, for a planned transaction with no time of its own. */
  time: string;
  nudgeOnDay: boolean;
  filter: ReminderFilter;
  minAmount: string;
  digest: boolean;
  warnShort: boolean;
}

interface PlannedReminder {
  identifier: string;
  triggerDate: Date;
  title: string;
  body: string;
  categoryIdentifier?: 'planned' | 'planned-short';
  data: { plannedKey?: string; dueDate?: string; accountId?: string };
}

function clockOf(raw: string | null | undefined): Clock | null {
  if (!raw) return null;
  const [h, m] = raw.split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h! < 0 || h! > 23 || m! < 0 || m! > 59)
    return null;
  return { hour: h!, minute: m! };
}

/** The days an item is planned on that are still ahead, within the horizon, not skipped. */
function occurrenceDays(f: ReminderItem['fields'], now: Date): string[] {
  const today = localDay(now);
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + HORIZON_DAYS);
  const until = localDay(horizon);
  const from = f.date > today ? f.date : today;
  return f.repeats && f.repetitions?.length
    ? upcomingOccurrences(f.repetitions, from, {
        count: MAX_PER_ITEM,
        until,
        skipDays: f.skipDays,
      })
    : [f.date].filter((d) => d >= today && d <= until && !f.skipDays?.includes(d));
}

/**
 * The reminders for one planned transaction: on the day of each upcoming occurrence, and
 * `leadDays` before it, at the planned time or `options.time`. Only future ones, only within the
 * horizon. `nudgeOnDay: false` leaves out the on-the-day one when there is a lead.
 */
export function computePlannedNotificationTargets(
  item: ReminderItem,
  now = new Date(),
  leadDays = DEFAULT_PLANNED_REMINDER_LEAD,
  options: { time?: string; nudgeOnDay?: boolean } = {},
): PlannedNotificationTarget[] {
  const f = item.fields;
  const clock = clockOf(f.time) ?? clockOf(options.time) ?? FALLBACK_CLOCK;
  // The lead reminder first, so the day's own one is the last thing scheduled for that date.
  const leads = leadDays > 0 ? (options.nudgeOnDay === false ? [leadDays] : [leadDays, 0]) : [0];

  const targets: PlannedNotificationTarget[] = [];
  for (const day of occurrenceDays(f, now)) {
    const [year, month, date] = day.split('-').map(Number);
    if (!year || !month || !date) continue;
    for (const lead of leads) {
      const at = new Date(year, month - 1, date - lead, clock.hour, clock.minute, 0, 0);
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

const absAmount = (amount: string) => amount.trim().replace(/^-/, '') || '0';

/** Whether a payment is reminded about at all under the `all` / `bigger` / `outgoing` setting. */
export function matchesReminderFilter(
  fields: Pick<ReminderItem['fields'], 'type' | 'amount'>,
  filter: ReminderFilter,
  minAmount: string,
): boolean {
  if (filter === 'outgoing') return (fields.type ?? 'withdrawal') === 'withdrawal';
  if (filter === 'bigger') return compareDecimal(absAmount(fields.amount), minAmount) >= 0;
  return true;
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

const hasOwn = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const checkKey = (plannedKey: string, dueDate: string) => `${plannedKey}|${dueDate}`;

function digestReminder(
  group: PlannedNotificationTarget[],
  currencies: Currencies,
): PlannedReminder {
  const first = group[0]!;
  const count = group.length;
  const currency = currencyOf(currencies, first.currencyCode);
  const sameCurrency = group.every((t) => t.currencyCode === first.currencyCode);
  const total = sameCurrency
    ? formatMoney(
        group.reduce((sum, t) => addDecimal(sum, absAmount(t.amount)), '0'),
        currency,
      )
    : null;
  const phrase =
    first.leadDays === 0
      ? i18n.t('reminders.notif.digestToday', {
          count,
          defaultValue: '{{count}} payments today',
        })
      : first.leadDays === 1
        ? i18n.t('reminders.notif.digestTomorrow', {
            count,
            defaultValue: '{{count}} payments tomorrow',
          })
        : i18n.t('reminders.notif.digestOn', {
            count,
            date: shortDate(first.dueDate),
            defaultValue: '{{count}} payments on {{date}}',
          });
  return {
    identifier: `${NOTIFICATION_PREFIX}digest:${first.triggerDate.getTime()}:${first.leadDays}`,
    triggerDate: first.triggerDate,
    title: total ? `${phrase} · ${total}` : phrase,
    body: group.map((t) => t.name).join(', '),
    data: { dueDate: first.dueDate },
  };
}

function shortDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(appLocale(), {
    month: 'short',
    day: 'numeric',
  });
}

function weekdayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(appLocale(), { weekday: 'long' });
}

/**
 * Every notification the planned transactions should have scheduled right now. Pure: the items,
 * the account balances (as last synced), the settings and `now` decide it all.
 *
 * - a per-payment override ('off' or a timing) replaces the global timing;
 * - the filter (`all` / `bigger` / `outgoing`) decides which payments are reminded about;
 * - with the warning on, each outgoing payment is walked in date order against its source
 *   account's balance; one that exceeds what is left gets a warning the day before, and every
 *   reminder for a payment that passed the check says so. Payments outside the filter still count
 *   against the balance: they leave the money whether or not they are reminded about.
 */
export function planPlannedReminders(
  items: readonly ReminderItem[],
  accounts: readonly AccountRow[],
  settings: PlannedReminderSettings,
  currencies: Currencies = [],
  now = new Date(),
): PlannedReminder[] {
  // The lead in days for a payment, or null when it gets no reminders.
  const leadOf = (key: string): number | null => {
    const override = hasOwn(settings.overrides, key) ? settings.overrides[key] : undefined;
    if (override === 'off') return null;
    return REMINDER_WHEN_LEAD[override ?? settings.when];
  };
  const reminded = (item: ReminderItem) =>
    leadOf(item.key) !== null &&
    matchesReminderFilter(item.fields, settings.filter, settings.minAmount);
  const clockFor = (f: ReminderItem['fields']) =>
    clockOf(f.time) ?? clockOf(settings.time) ?? FALLBACK_CLOCK;

  // Occurrence day -> whether the source account covers it.
  const enough = new Map<string, boolean>();
  const warnings: PlannedReminder[] = [];
  if (settings.warnShort) {
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const perAccount = new Map<string, { item: ReminderItem; day: string }[]>();
    for (const item of items) {
      const f = item.fields;
      if (f.type === 'deposit' || !f.sourceId || !accountById.has(f.sourceId)) continue;
      const list = perAccount.get(f.sourceId) ?? [];
      for (const day of occurrenceDays(f, now)) list.push({ item, day });
      perAccount.set(f.sourceId, list);
    }
    for (const [accountId, occurrences] of perAccount) {
      const account = accountById.get(accountId)!;
      if (account.currentBalance == null) continue;
      let remaining = account.currentBalance;
      occurrences.sort((a, b) =>
        a.day !== b.day ? (a.day < b.day ? -1 : 1) : a.item.key.localeCompare(b.item.key),
      );
      for (const { item, day } of occurrences) {
        const f = item.fields;
        if (f.currencyCode !== account.currencyCode) continue;
        const amount = absAmount(f.amount);
        const covered = compareDecimal(amount, remaining) <= 0;
        enough.set(checkKey(item.key, day), covered);
        if (!covered && reminded(item)) {
          const [y, m, d] = day.split('-').map(Number);
          const clock = clockFor(f);
          const triggerDate = new Date(y!, m! - 1, d! - 1, clock.hour, clock.minute, 0, 0);
          if (triggerDate.getTime() > now.getTime()) {
            const currency = currencyOf(currencies, f.currencyCode);
            warnings.push({
              identifier: `${NOTIFICATION_PREFIX}short:${accountId}:${day}:${item.key}`,
              triggerDate,
              title: i18n.t('reminders.notif.shortTitle', {
                account: account.name,
                defaultValue: '{{account}} may run short',
              }),
              body: i18n.t('reminders.notif.shortBody', {
                name: f.name,
                amount: formatMoney(amount, currency),
                weekday: weekdayOf(day),
                balance: formatMoney(remaining, currency),
                defaultValue:
                  "{{name}} takes {{amount}} on {{weekday}}. There's {{balance}} in it.",
              }),
              categoryIdentifier: 'planned-short',
              data: { plannedKey: item.key, dueDate: day, accountId },
            });
          }
        }
        remaining = subtractDecimal(remaining, amount);
      }
    }
  }

  const targets: PlannedNotificationTarget[] = [];
  for (const item of items) {
    if (!reminded(item)) continue;
    targets.push(
      ...computePlannedNotificationTargets(item, now, leadOf(item.key) ?? 0, {
        time: settings.time,
        nudgeOnDay: settings.nudgeOnDay,
      }),
    );
  }

  // With the digest on, one notification per trigger minute and lead: its payments share a due date.
  const groups = new Map<string, PlannedNotificationTarget[]>();
  for (const t of targets) {
    const key = settings.digest ? `${t.triggerDate.getTime()}|${t.leadDays}` : t.identifier;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const reminders: PlannedReminder[] = [];
  for (const group of groups.values()) {
    if (group.length > 1) {
      reminders.push(digestReminder(group, currencies));
      continue;
    }
    const t = group[0]!;
    const body =
      formatPlannedNotificationBody(t, currencies) +
      (enough.get(checkKey(t.plannedKey, t.dueDate))
        ? i18n.t('reminders.notif.enoughSuffix', { defaultValue: " There's enough in it." })
        : '');
    reminders.push({
      identifier: t.identifier,
      triggerDate: t.triggerDate,
      title: t.name,
      body,
      categoryIdentifier: 'planned',
      data: { plannedKey: t.plannedKey, dueDate: t.dueDate },
    });
  }
  return [...reminders, ...warnings];
}

/**
 * The notification buttons: "Skip this one" and "Open" on a reminder, "Move money" and "Open" on a
 * short-balance warning. Each opens the app; the response is handled in app/_layout.tsx.
 */
export async function registerPlannedNotificationCategories(): Promise<void> {
  try {
    const open = {
      identifier: 'open',
      buttonTitle: i18n.t('reminders.notif.actionOpen', { defaultValue: 'Open' }),
      options: { opensAppToForeground: true },
    };
    await Notifications.setNotificationCategoryAsync('planned', [
      {
        identifier: 'skip',
        buttonTitle: i18n.t('reminders.notif.actionSkip', { defaultValue: 'Skip this one' }),
        options: { opensAppToForeground: true },
      },
      open,
    ]);
    await Notifications.setNotificationCategoryAsync('planned-short', [
      {
        identifier: 'move',
        buttonTitle: i18n.t('reminders.notif.actionMove', { defaultValue: 'Move money' }),
        options: { opensAppToForeground: true },
      },
      open,
    ]);
  } catch (err) {
    logLine('warn', `could not register planned notification actions: ${errorMessage(err)}`);
  }
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

async function readReminderSettings(db: OutboxDb): Promise<PlannedReminderSettings> {
  return {
    when: await getReminderWhen(db),
    overrides: await getReminderOverrides(db),
    time: await getReminderTime(db),
    nudgeOnDay: await getReminderNudgeOnDay(db),
    filter: await getReminderFilter(db),
    minAmount: await getReminderMinAmount(db),
    digest: await getReminderDigest(db),
    warnShort: await getReminderWarnShort(db),
  };
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

    const settings = await readReminderSettings(db);
    const accounts = await db.select().from(referenceAccounts);
    const resolvedCurrencies =
      currencies && currencies.length > 0
        ? currencies
        : await db.select().from(referenceCurrencies);

    const reminders = planPlannedReminders(items, accounts, settings, resolvedCurrencies, now);
    for (const reminder of reminders) {
      await Notifications.scheduleNotificationAsync({
        identifier: reminder.identifier,
        content: {
          title: reminder.title,
          body: reminder.body,
          data: reminder.data,
          categoryIdentifier: reminder.categoryIdentifier,
        },
        trigger: {
          type: SchedulableTriggerInputTypes.DATE,
          date: reminder.triggerDate,
          channelId: PLANNED_NOTIFICATION_CHANNEL_ID,
        },
      });
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
