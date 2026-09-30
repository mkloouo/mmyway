// Everything the Settings screen shows, read in one pass. It used to be twelve `useState`s plus a
// `reload()` that set all twelve again from each sheet's `onClose`; now it is one TanStack Query,
// invalidated after a write.
import type { OutboxDb } from '../sync/outbox';
import type { AppLocale } from '../i18n';
import { readStoredCredentials } from '../api/ff3/auth';
import { readHosts } from '../api/ff3/hosts';
import { readGeminiKey } from './secrets';
import {
  getCashAccountId,
  getDefaultCurrencyCode,
  getDefaultSourceAccountId,
  getFf3ActiveHost,
  getLastSyncedAt,
  getLocalModelActiveUrl,
  getLocalModelBaseUrls,
  getLocalModelName,
  getLocale,
} from './appSettings';

interface AppSettingsSnapshot {
  signedIn: boolean;
  ff3Hosts: string[];
  ff3ActiveHost: string | null;
  localModelUrls: string[];
  localModelActiveUrl: string | null;
  localModelName: string;
  hasGeminiKey: boolean;
  defaultAccountId: string | null;
  defaultCurrency: string | null;
  cashAccountId: string | null;
  lastSyncedAt: string | null;
  locale: AppLocale;
}

export const SETTINGS_QUERY_KEY = ['settings'] as const;

export async function loadSettings(db: OutboxDb): Promise<AppSettingsSnapshot> {
  const [
    creds,
    ff3Hosts,
    ff3ActiveHost,
    localModelUrls,
    localModelActiveUrl,
    localModelName,
    geminiKey,
    defaultAccountId,
    defaultCurrency,
    cashAccountId,
    lastSyncedAt,
    locale,
  ] = await Promise.all([
    readStoredCredentials(),
    readHosts(),
    getFf3ActiveHost(db),
    getLocalModelBaseUrls(db),
    getLocalModelActiveUrl(db),
    getLocalModelName(db),
    readGeminiKey(),
    getDefaultSourceAccountId(db),
    getDefaultCurrencyCode(db),
    getCashAccountId(db),
    getLastSyncedAt(db),
    getLocale(db),
  ]);
  return {
    signedIn: !!creds,
    ff3Hosts,
    ff3ActiveHost,
    localModelUrls,
    localModelActiveUrl,
    localModelName: localModelName ?? '',
    hasGeminiKey: !!geminiKey,
    defaultAccountId,
    defaultCurrency,
    cashAccountId,
    lastSyncedAt,
    locale,
  };
}
