// Typed accessors over app_settings (non-secret values only). The FF3 token and Gemini key
// stay in SecureStore (src/api/ff3/auth.ts, src/settings/secrets.ts).
import { eq } from 'drizzle-orm';
import { appSettings } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';

const KEYS = {
  defaultSourceAccountId: 'default_source_account_id',
  defaultCurrencyCode: 'default_currency_code',
  localModelBaseUrl: 'local_model_base_url',
  localModelBaseUrls: 'local_model_base_urls',
  localModelActiveUrl: 'local_model_active_url',
  localModelName: 'local_model_name',
  ff3ActiveHost: 'ff3_active_host',
  lastSyncedAt: 'last_synced_at',
  useServerTime: 'use_server_time',
} as const;

async function getSetting(db: OutboxDb, key: string): Promise<string | null> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return rows[0]?.value ?? null;
}

async function setSetting(db: OutboxDb, key: string, value: string): Promise<void> {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

export const getDefaultSourceAccountId = (db: OutboxDb) => getSetting(db, KEYS.defaultSourceAccountId);
export const setDefaultSourceAccountId = (db: OutboxDb, value: string) => setSetting(db, KEYS.defaultSourceAccountId, value);

export const getDefaultCurrencyCode = (db: OutboxDb) => getSetting(db, KEYS.defaultCurrencyCode);
export const setDefaultCurrencyCode = (db: OutboxDb, value: string) => setSetting(db, KEYS.defaultCurrencyCode, value);

export const getLocalModelBaseUrl = (db: OutboxDb) => getSetting(db, KEYS.localModelBaseUrl);
export const setLocalModelBaseUrl = (db: OutboxDb, value: string) => setSetting(db, KEYS.localModelBaseUrl, value);

export const getLocalModelName = (db: OutboxDb) => getSetting(db, KEYS.localModelName);
export const setLocalModelName = (db: OutboxDb, value: string) => setSetting(db, KEYS.localModelName, value);

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
export const setLocalModelBaseUrls = (db: OutboxDb, list: string[]) => setSetting(db, KEYS.localModelBaseUrls, JSON.stringify(list));

export const getLocalModelActiveUrl = (db: OutboxDb) => getSetting(db, KEYS.localModelActiveUrl);
export const setLocalModelActiveUrl = (db: OutboxDb, value: string) => setSetting(db, KEYS.localModelActiveUrl, value);

export const getFf3ActiveHost = (db: OutboxDb) => getSetting(db, KEYS.ff3ActiveHost);
export const setFf3ActiveHost = (db: OutboxDb, value: string) => setSetting(db, KEYS.ff3ActiveHost, value);

export const getLastSyncedAt = (db: OutboxDb) => getSetting(db, KEYS.lastSyncedAt);
export const setLastSyncedAt = (db: OutboxDb, value: string) => setSetting(db, KEYS.lastSyncedAt, value);

export async function getUseServerTime(db: OutboxDb): Promise<boolean> {
  return (await getSetting(db, KEYS.useServerTime)) === '1';
}
export const setUseServerTime = (db: OutboxDb, value: boolean) => setSetting(db, KEYS.useServerTime, value ? '1' : '0');
