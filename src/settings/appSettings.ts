// Typed accessors over app_settings (non-secret values only). The FF3 token and Gemini key
// stay in SecureStore (src/api/ff3/auth.ts, src/settings/secrets.ts).
import { eq } from 'drizzle-orm';
import { appSettings } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';
import type { AppLocale } from '../i18n';

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
  ff3ActiveHost: 'ff3_active_host',
  lastSyncedAt: 'last_synced_at',
  useServerTime: 'use_server_time',
  accountOrder: 'account_order',
  balancesStale: 'balances_stale',
  locale: 'locale',
  plannedMode: 'planned_mode',
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

/** The Planned tab's view: `simple` (one row per name, editable) or `detailed` (FF3's objects as they are). */
export type PlannedMode = 'simple' | 'detailed';
export const PLANNED_MODE_KEY = KEYS.plannedMode;
export function parsePlannedMode(raw: string | null | undefined): PlannedMode {
  return raw === 'detailed' ? 'detailed' : 'simple';
}
export const setPlannedMode = (db: OutboxDb, value: PlannedMode) =>
  setSetting(db, KEYS.plannedMode, value);
