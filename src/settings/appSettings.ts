// Typed accessors over app_settings (non-secret values only). The FF3 token and Gemini key
// stay in SecureStore (src/api/ff3/auth.ts, src/settings/secrets.ts).
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appSettings } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';
import type { AppLocale } from '../i18n';
import { parseDecimalInput } from '../api/ff3/decimal';
import { isFlagName, type FlagValues } from '../flags/registry';

const KEYS = {
  defaultSourceAccountId: 'default_source_account_id',
  defaultCurrencyCode: 'default_currency_code',
  cashAccountId: 'cash_account_id',
  reconcileShortfallAccountId: 'reconcile_shortfall_account_id',
  reconcileSurplusAccountId: 'reconcile_surplus_account_id',
  reconcileCategoryName: 'reconcile_category_name',
  localModelBaseUrl: 'local_model_base_url',
  localModelBaseUrls: 'local_model_base_urls',
  localModelActiveUrl: 'local_model_active_url',
  localModelName: 'local_model_name',
  receiptReader: 'receipt_reader',
  ff3ActiveHost: 'ff3_active_host',
  lastSyncedAt: 'last_synced_at',
  useServerTime: 'use_server_time',
  accountOrder: 'account_order',
  balancesStale: 'balances_stale',
  locale: 'locale',
  recordLocation: 'record_location',
  plannedNotificationsEnabled: 'planned_notifications_enabled',
  plannedReminderLead: 'planned_reminder_lead_days',
  plannedReminderTime: 'planned_reminder_time',
  plannedReminderNudgeOnDay: 'planned_reminder_nudge_on_day',
  plannedReminderFilter: 'planned_reminder_filter',
  plannedReminderMinAmount: 'planned_reminder_min_amount',
  plannedReminderDigest: 'planned_reminder_digest',
  plannedReminderWarnShort: 'planned_reminder_warn_short',
  plannedReminderOverrides: 'planned_reminder_overrides',
  plannedReminderPromptShown: 'planned_reminder_prompt_shown',
  appLockEnabled: 'app_lock_enabled',
  demo: 'demo',
  featureFlags: 'feature_flags',
  featureFlagOverrides: 'feature_flag_overrides',
} as const;

async function getSetting(db: OutboxDb, key: string): Promise<string | null> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return rows[0]?.value ?? null;
}

async function setSetting(db: OutboxDb, key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

/**
 * The settings that describe one FF3 instance rather than the user's preferences: they must not
 * carry over when the app is pointed at another instance (src/sync/instanceData.ts).
 */
export const INSTANCE_SETTING_KEYS: readonly string[] = [
  KEYS.ff3ActiveHost,
  KEYS.lastSyncedAt,
  KEYS.accountOrder,
  KEYS.balancesStale,
  // Settings that name an account by its FF3 id: an old `3` would point at whatever the next
  // instance calls `3`, the same risk as an id in a draft.
  KEYS.defaultSourceAccountId,
  KEYS.cashAccountId,
  KEYS.reconcileShortfallAccountId,
  KEYS.reconcileSurplusAccountId,
];

export const getDefaultSourceAccountId = (db: OutboxDb) =>
  getSetting(db, KEYS.defaultSourceAccountId);
export const setDefaultSourceAccountId = (db: OutboxDb, value: string) =>
  setSetting(db, KEYS.defaultSourceAccountId, value);

// Which asset account a cash receipt's source is (design §6.6) — a dedicated setting, not the
// `/cash/i` name match buildReceiptDraftReference used to fall back on.
export const getCashAccountId = (db: OutboxDb) => getSetting(db, KEYS.cashAccountId);
export const setCashAccountId = (db: OutboxDb, value: string) =>
  setSetting(db, KEYS.cashAccountId, value);

// The cash count's adjustment payees (design §6.9): an expense account for a shortfall, a
// revenue account for a surplus, picked once from the reference tables.
export const getReconcileShortfallAccountId = (db: OutboxDb) =>
  getSetting(db, KEYS.reconcileShortfallAccountId);
export const setReconcileShortfallAccountId = (db: OutboxDb, value: string) =>
  setSetting(db, KEYS.reconcileShortfallAccountId, value);

export const getReconcileSurplusAccountId = (db: OutboxDb) =>
  getSetting(db, KEYS.reconcileSurplusAccountId);
export const setReconcileSurplusAccountId = (db: OutboxDb, value: string) =>
  setSetting(db, KEYS.reconcileSurplusAccountId, value);

export const getReconcileCategoryName = (db: OutboxDb) =>
  getSetting(db, KEYS.reconcileCategoryName);
export const setReconcileCategoryName = (db: OutboxDb, value: string) =>
  setSetting(db, KEYS.reconcileCategoryName, value);

export const getDefaultCurrencyCode = (db: OutboxDb) => getSetting(db, KEYS.defaultCurrencyCode);
export const setDefaultCurrencyCode = (db: OutboxDb, value: string) =>
  setSetting(db, KEYS.defaultCurrencyCode, value);

export const getLocalModelBaseUrl = (db: OutboxDb) => getSetting(db, KEYS.localModelBaseUrl);
export const setLocalModelBaseUrl = (db: OutboxDb, value: string) =>
  setSetting(db, KEYS.localModelBaseUrl, value);

export const getLocalModelName = (db: OutboxDb) => getSetting(db, KEYS.localModelName);
export const setLocalModelName = (db: OutboxDb, value: string) =>
  setSetting(db, KEYS.localModelName, value);

/**
 * Who reads a receipt photo (Settings → Receipt reading): 'none' nobody (the photo is attached and
 * the details are typed), 'local' only the user's own model, 'auto' the model, then Gemini when it
 * can't. Unset or unknown is 'auto', what the app did before this setting existed.
 */
const RECEIPT_READERS = ['none', 'local', 'auto'] as const;
export type ReceiptReader = (typeof RECEIPT_READERS)[number];
function parseReceiptReader(raw: string | null | undefined): ReceiptReader {
  return RECEIPT_READERS.find((r) => r === raw) ?? 'auto';
}
export const getReceiptReader = async (db: OutboxDb) =>
  parseReceiptReader(await getSetting(db, KEYS.receiptReader));
export const setReceiptReader = (db: OutboxDb, value: ReceiptReader) =>
  setSetting(db, KEYS.receiptReader, value);

// Several addresses per server (design §6.6): same idea as src/api/ff3/hosts.ts's ff3_hosts, but
// non-secret so it lives in app_settings rather than SecureStore. Reading falls back to the
// legacy single local_model_base_url key so an installed app keeps working.
export async function getLocalModelBaseUrls(db: OutboxDb): Promise<string[]> {
  const raw = await getSetting(db, KEYS.localModelBaseUrls);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) return parsed;
    } catch {
      // fall through to the legacy key
    }
  }
  const legacy = await getLocalModelBaseUrl(db);
  return legacy ? [legacy] : [];
}
export const setLocalModelBaseUrls = (db: OutboxDb, list: string[]) =>
  setSetting(db, KEYS.localModelBaseUrls, JSON.stringify(list));

export const getLocalModelActiveUrl = (db: OutboxDb) => getSetting(db, KEYS.localModelActiveUrl);
export const setLocalModelActiveUrl = (db: OutboxDb, value: string) =>
  setSetting(db, KEYS.localModelActiveUrl, value);

export const getFf3ActiveHost = (db: OutboxDb) => getSetting(db, KEYS.ff3ActiveHost);
export const setFf3ActiveHost = (db: OutboxDb, value: string) =>
  setSetting(db, KEYS.ff3ActiveHost, value);

export const getLastSyncedAt = (db: OutboxDb) => getSetting(db, KEYS.lastSyncedAt);
export const setLastSyncedAt = (db: OutboxDb, value: string) =>
  setSetting(db, KEYS.lastSyncedAt, value);

export async function getUseServerTime(db: OutboxDb): Promise<boolean> {
  return (await getSetting(db, KEYS.useServerTime)) === '1';
}
export const setUseServerTime = (db: OutboxDb, value: boolean) =>
  setSetting(db, KEYS.useServerTime, value ? '1' : '0');

/** The settings key accountOrder lives under, for a live query of it (src/accounts/useAssetAccounts.ts). */
export const ACCOUNT_ORDER_KEY = KEYS.accountOrder;

/**
 * FF3's own account order (the `order` attribute, set by dragging accounts in FF3 or by
 * Settings → Accounts → Reorder), cached as { accountId: order }. Kept here rather than as a
 * reference_accounts column so no schema migration is needed.
 */
export function parseAccountOrder(raw: string | null | undefined): Record<string, number> {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
export async function getAccountOrder(db: OutboxDb): Promise<Record<string, number>> {
  return parseAccountOrder(await getSetting(db, KEYS.accountOrder));
}
export const setAccountOrder = (db: OutboxDb, order: Record<string, number>) =>
  setSetting(db, KEYS.accountOrder, JSON.stringify(order));

/** The settings key balancesStale lives under, for a live query of it (app/count.tsx). */
export const BALANCES_STALE_KEY = KEYS.balancesStale;

/**
 * Set while a write may have reached FF3 since account balances were last read (runSync), so the
 * cached `current_balance` can be missing it. The cash count must not compare against such a
 * balance: it would see the synced spending as drift and book it a second time.
 */
export async function getBalancesStale(db: OutboxDb): Promise<boolean> {
  return (await getSetting(db, KEYS.balancesStale)) === '1';
}
export const setBalancesStale = (db: OutboxDb, value: boolean) =>
  setSetting(db, KEYS.balancesStale, value ? '1' : '0');

/** The settings key the UI language lives under, for a live query of it (src/i18n/LocaleSync.tsx). */
export const LOCALE_KEY = KEYS.locale;

const LOCALES: readonly AppLocale[] = ['system', 'en', 'uk-UA'];

/** Settings → Language: a picked language, or "system" (the default) to follow the device. */
export function parseLocale(raw: string | null | undefined): AppLocale {
  return LOCALES.find((l) => l === raw) ?? 'system';
}
export const getLocale = async (db: OutboxDb) => parseLocale(await getSetting(db, KEYS.locale));
export const setLocale = (db: OutboxDb, value: AppLocale) => setSetting(db, KEYS.locale, value);

/**
 * Whether a new entry records where it was made (#67). On unless it was turned off, so the
 * permission prompt is the only thing standing between a fresh install and a located entry —
 * and turning it off here keeps the permission but stops using it.
 */
export async function getRecordLocation(db: OutboxDb): Promise<boolean> {
  return (await getSetting(db, KEYS.recordLocation)) !== '0';
}
export const setRecordLocation = (db: OutboxDb, value: boolean) =>
  setSetting(db, KEYS.recordLocation, value ? '1' : '0');

export async function getPlannedNotificationsEnabled(db: OutboxDb): Promise<boolean> {
  return (await getSetting(db, KEYS.plannedNotificationsEnabled)) === '1';
}
export const setPlannedNotificationsEnabled = (db: OutboxDb, value: boolean) =>
  setSetting(db, KEYS.plannedNotificationsEnabled, value ? '1' : '0');

/**
 * How many days before a planned transaction its reminder arrives, besides the one on the day
 * itself. 2 is what the app shipped with, so an install that never touches this keeps it.
 */
const PLANNED_REMINDER_LEADS: readonly number[] = [0, 1, 2, 3, 7];
export const DEFAULT_PLANNED_REMINDER_LEAD = 2;
function parsePlannedReminderLead(raw: string | null | undefined): number {
  // Not `Number(raw)`: `Number(null)` and `Number('')` are both 0, which is a value the user can
  // choose ("only on the day") — an unset setting has to mean the default, not that.
  if (raw == null || raw === '') return DEFAULT_PLANNED_REMINDER_LEAD;
  const value = Number(raw);
  return PLANNED_REMINDER_LEADS.includes(value) ? value : DEFAULT_PLANNED_REMINDER_LEAD;
}
export const getPlannedReminderLead = async (db: OutboxDb) =>
  parsePlannedReminderLead(await getSetting(db, KEYS.plannedReminderLead));
export const setPlannedReminderLead = (db: OutboxDb, value: number) =>
  setSetting(db, KEYS.plannedReminderLead, String(value));

/**
 * The reminder's timing as the settings page names it. Stored as the old lead-days key, so the
 * scheduler and any older reader agree; there is no separate key.
 */
export type ReminderWhen = 'day' | 'dayBefore' | 'fewDays' | 'week';
export const REMINDER_WHEN_LEAD: Record<ReminderWhen, number> = {
  day: 0,
  dayBefore: 1,
  fewDays: 2,
  week: 7,
};
function reminderWhenFromLead(lead: number): ReminderWhen {
  if (lead === 0) return 'day';
  if (lead === 1) return 'dayBefore';
  if (lead <= 3) return 'fewDays';
  return 'week';
}
/** Read from the stored lead, so an install that never chose keeps the old default (2 → `fewDays`). */
export const getReminderWhen = async (db: OutboxDb): Promise<ReminderWhen> =>
  reminderWhenFromLead(await getPlannedReminderLead(db));
export const setReminderWhen = (db: OutboxDb, value: ReminderWhen) =>
  setPlannedReminderLead(db, REMINDER_WHEN_LEAD[value]);

const REMINDER_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The time a reminder fires when the planned transaction has none of its own. */
export const DEFAULT_REMINDER_TIME = '09:00';
export async function getReminderTime(db: OutboxDb): Promise<string> {
  const raw = await getSetting(db, KEYS.plannedReminderTime);
  return raw && REMINDER_TIME_PATTERN.test(raw) ? raw : DEFAULT_REMINDER_TIME;
}
export const setReminderTime = (db: OutboxDb, value: string) => {
  if (!REMINDER_TIME_PATTERN.test(value)) throw new Error(`invalid reminder time: ${value}`);
  return setSetting(db, KEYS.plannedReminderTime, value);
};

/** Whether an on-the-day reminder comes in addition to the lead one. On unless turned off. */
export async function getReminderNudgeOnDay(db: OutboxDb): Promise<boolean> {
  return (await getSetting(db, KEYS.plannedReminderNudgeOnDay)) !== '0';
}
export const setReminderNudgeOnDay = (db: OutboxDb, value: boolean) =>
  setSetting(db, KEYS.plannedReminderNudgeOnDay, value ? '1' : '0');

export type ReminderFilter = 'all' | 'bigger' | 'outgoing';
const REMINDER_FILTERS: readonly ReminderFilter[] = ['all', 'bigger', 'outgoing'];
export async function getReminderFilter(db: OutboxDb): Promise<ReminderFilter> {
  const raw = await getSetting(db, KEYS.plannedReminderFilter);
  return REMINDER_FILTERS.find((f) => f === raw) ?? 'all';
}
export const setReminderFilter = (db: OutboxDb, value: ReminderFilter) =>
  setSetting(db, KEYS.plannedReminderFilter, value);

const DEFAULT_REMINDER_MIN_AMOUNT = '200';
/** The threshold for the `bigger` filter: a decimal string, validated the way typed amounts are. */
export async function getReminderMinAmount(db: OutboxDb): Promise<string> {
  const raw = await getSetting(db, KEYS.plannedReminderMinAmount);
  const parsed = raw == null ? null : parseDecimalInput(raw);
  return parsed?.ok ? parsed.value : DEFAULT_REMINDER_MIN_AMOUNT;
}
export async function setReminderMinAmount(db: OutboxDb, value: string): Promise<void> {
  const parsed = parseDecimalInput(value);
  if (!parsed.ok) throw new Error(`invalid reminder minimum amount: ${value}`);
  await setSetting(db, KEYS.plannedReminderMinAmount, parsed.value);
}

/** One message per day instead of one per payment. Off unless turned on. */
export async function getReminderDigest(db: OutboxDb): Promise<boolean> {
  return (await getSetting(db, KEYS.plannedReminderDigest)) === '1';
}
export const setReminderDigest = (db: OutboxDb, value: boolean) =>
  setSetting(db, KEYS.plannedReminderDigest, value ? '1' : '0');

/** The "may run short" warning and the "enough in it" note on reminders. On unless turned off. */
export async function getReminderWarnShort(db: OutboxDb): Promise<boolean> {
  return (await getSetting(db, KEYS.plannedReminderWarnShort)) !== '0';
}
export const setReminderWarnShort = (db: OutboxDb, value: boolean) =>
  setSetting(db, KEYS.plannedReminderWarnShort, value ? '1' : '0');

const ReminderOverridesSchema = z.record(
  z.string(),
  z.enum(['day', 'dayBefore', 'fewDays', 'week', 'off']),
);

/** Per-payment reminder timing, keyed by planned key. Bad JSON or an unknown value reads as none. */
export async function getReminderOverrides(
  db: OutboxDb,
): Promise<Record<string, ReminderWhen | 'off'>> {
  const raw = await getSetting(db, KEYS.plannedReminderOverrides);
  if (raw == null) return {};
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {};
  }
  const parsed = ReminderOverridesSchema.safeParse(json);
  return parsed.success ? parsed.data : {};
}
/** `null` removes the override, so the payment goes back to the global setting. */
export async function setReminderOverride(
  db: OutboxDb,
  plannedKey: string,
  value: ReminderWhen | 'off' | null,
): Promise<void> {
  const next = await getReminderOverrides(db);
  if (value === null) delete next[plannedKey];
  else next[plannedKey] = value;
  await setSetting(db, KEYS.plannedReminderOverrides, JSON.stringify(next));
}

/** Whether the first-time reminder sheet has been shown. */
export async function getReminderPromptShown(db: OutboxDb): Promise<boolean> {
  return (await getSetting(db, KEYS.plannedReminderPromptShown)) === '1';
}
export const setReminderPromptShown = (db: OutboxDb, value: boolean) =>
  setSetting(db, KEYS.plannedReminderPromptShown, value ? '1' : '0');

/** The settings key the app lock lives under, for a live query of it (src/lock/useAppLock.ts). */
export const APP_LOCK_ENABLED_KEY = KEYS.appLockEnabled;

/**
 * Settings → Security → Require unlock. Off unless it was turned on: a lock nobody asked for,
 * on a phone whose biometrics later stop working, is a way to be shut out of your own ledger.
 */
export async function getAppLockEnabled(db: OutboxDb): Promise<boolean> {
  return (await getSetting(db, KEYS.appLockEnabled)) === '1';
}
export const setAppLockEnabled = (db: OutboxDb, value: boolean) =>
  setSetting(db, KEYS.appLockEnabled, value ? '1' : '0');

/**
 * Settings → Firefly III → Try the demo. Set while the app shows the seeded sample data
 * (src/demo/demo.ts). Not an instance setting: it is cleared by leaveDemo, not by a sign-in.
 */
export async function getDemoMode(db: OutboxDb): Promise<boolean> {
  return (await getSetting(db, KEYS.demo)) === '1';
}
export const setDemoMode = (db: OutboxDb, value: boolean) =>
  setSetting(db, KEYS.demo, value ? '1' : '0');

// Feature flags (src/flags) are per app, not per FF3 instance, so they stay out of
// INSTANCE_SETTING_KEYS. JSON in a string; a missing or corrupt value reads as no flags.
const FLAG_MAP = z.record(z.string(), z.boolean());

function parseFlagMap(raw: string | null): FlagValues {
  if (raw === null) return {};
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {};
  }
  const parsed = FLAG_MAP.safeParse(json);
  if (!parsed.success) return {};
  const values: FlagValues = {};
  for (const [name, on] of Object.entries(parsed.data)) {
    if (isFlagName(name)) values[name] = on;
  }
  return values;
}

/** The last values Flagsmith answered with (src/flags/FlagsSync.tsx). */
export const getCachedFlags = async (db: OutboxDb) =>
  parseFlagMap(await getSetting(db, KEYS.featureFlags));
export const setCachedFlags = (db: OutboxDb, values: FlagValues) =>
  setSetting(db, KEYS.featureFlags, JSON.stringify(values));

/** Local overrides, for testing a flag on this device. Read by src/flags/resolve.ts. */
export const getFlagOverrides = async (db: OutboxDb) =>
  parseFlagMap(await getSetting(db, KEYS.featureFlagOverrides));
export const setFlagOverrides = (db: OutboxDb, values: FlagValues) =>
  setSetting(db, KEYS.featureFlagOverrides, JSON.stringify(values));
