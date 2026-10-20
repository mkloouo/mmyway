// Everything the Settings screen shows, read in one pass. It used to be twelve `useState`s plus a
// `reload()` that set all twelve again from each sheet's `onClose`; now it is one TanStack Query,
// invalidated after a write.
import type { OutboxDb } from '../sync/outbox';
import type { AppLocale } from '../i18n';
import { readStoredCredentials } from '../api/ff3/auth';
import { readHosts } from '../api/ff3/hosts';
import { loadProxyHeaders } from '../api/ff3/proxyHeaders';
import { readGeminiKey } from './secrets';
import {
  getCashAccountId,
  getDefaultCurrencyCode,
  getDefaultSourceAccountId,
  getFf3ActiveHost,
  getFf3Version,
  getLastSyncedAt,
  getLocalModelActiveUrl,
  getLocalModelBaseUrls,
  getLocalModelName,
  getLocale,
  getAppLockEnabled,
  getPlannedNotificationsEnabled,
  getPlannedReminderLead,
  getReminderTime,
  getRecordLocation,
} from './appSettings';

interface AppSettingsSnapshot {
  signedIn: boolean;
  ff3Hosts: string[];
  ff3ActiveHost: string | null;
  ff3Version: string | null;
  localModelUrls: string[];
  localModelActiveUrl: string | null;
  localModelName: string;
  hasGeminiKey: boolean;
  geminiKeyTail: string | null;
  defaultAccountId: string | null;
  defaultCurrency: string | null;
  cashAccountId: string | null;
  lastSyncedAt: string | null;
  locale: AppLocale;
  recordLocation: boolean;
  plannedNotifications: boolean;
  plannedReminderLead: number;
  plannedReminderTime: string;
  /** How many reverse-proxy headers are stored (src/api/ff3/proxyHeaders.ts); the values are secrets. */
  proxyHeaderCount: number;
  appLock: boolean;
}

export const SETTINGS_QUERY_KEY = ['settings'] as const;

export async function loadSettings(db: OutboxDb): Promise<AppSettingsSnapshot> {
  const [
    creds,
    ff3Hosts,
    ff3ActiveHost,
    ff3Version,
    localModelUrls,
    localModelActiveUrl,
    localModelName,
    geminiKey,
    defaultAccountId,
    defaultCurrency,
    cashAccountId,
    lastSyncedAt,
    locale,
    recordLocation,
    plannedNotifications,
    plannedReminderLead,
    plannedReminderTime,
    proxyHeaders,
    appLock,
  ] = await Promise.all([
    readStoredCredentials(),
    readHosts(),
    getFf3ActiveHost(db),
    getFf3Version(db),
    getLocalModelBaseUrls(db),
    getLocalModelActiveUrl(db),
    getLocalModelName(db),
    readGeminiKey(),
    getDefaultSourceAccountId(db),
    getDefaultCurrencyCode(db),
    getCashAccountId(db),
    getLastSyncedAt(db),
    getLocale(db),
    getRecordLocation(db),
    getPlannedNotificationsEnabled(db),
    getPlannedReminderLead(db),
    getReminderTime(db),
    loadProxyHeaders(),
    getAppLockEnabled(db),
  ]);
  return {
    signedIn: !!creds,
    ff3Hosts,
    ff3ActiveHost,
    ff3Version,
    localModelUrls,
    localModelActiveUrl,
    localModelName: localModelName ?? '',
    hasGeminiKey: !!geminiKey,
    geminiKeyTail: geminiKey ? (geminiKey.length >= 4 ? geminiKey.slice(-4) : geminiKey) : null,
    defaultAccountId,
    defaultCurrency,
    cashAccountId,
    lastSyncedAt,
    locale,
    recordLocation,
    plannedNotifications,
    plannedReminderLead,
    plannedReminderTime,
    proxyHeaderCount: Object.keys(proxyHeaders).length,
    appLock,
  };
}
