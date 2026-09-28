// UI strings (docs/LOCALIZATION.md). en.json is the source of truth; other locales are pulled from
// Tolgee and may hold "" for a key nobody has translated yet, which falls back to English.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import en from './locales/en.json';
import ukUA from './locales/uk-UA.json';

const resources = {
  en: { translation: en },
  ['uk-UA']: { translation: ukUA },
} as const;

export const SUPPORTED_LANGUAGES = Object.keys(resources);

/** What Settings → Language stores: a supported language, or "system" to follow the device. */
export type AppLocale = 'system' | 'en' | 'uk-UA';

// expo-localization returns the device's preferred locales, most-preferred first. Resource keys
// may be a bare language code ("en") or a full tag ("uk-UA"), so match each device locale against
// both its languageTag and languageCode before falling back to "en".
const supportedByLowerCase = new Map(SUPPORTED_LANGUAGES.map((lang) => [lang.toLowerCase(), lang]));

export function resolveDeviceLanguage(): string {
  return (
    Localization.getLocales()
      .flatMap((locale) => [locale.languageTag, locale.languageCode])
      .map((tag) => tag && supportedByLowerCase.get(tag.toLowerCase()))
      .find((lang): lang is string => lang != null) ?? 'en'
  );
}

/**
 * The locale dates and times are formatted in: the app's language, which may differ from the
 * device's when picked manually in Settings.
 */
export function appLocale(): string {
  return i18n.language || 'en';
}

// i18next's named `use` export is unbound; the instance method is the one to call.
// eslint-disable-next-line import/no-named-as-default-member
i18n.use(initReactI18next).init({
  resources,
  lng: resolveDeviceLanguage(),
  fallbackLng: 'en',
  // Locale files pulled from Tolgee hold "" for keys not translated yet. Without this, i18next
  // treats "" as a real (blank) translation and renders nothing; with it, an empty value counts
  // as missing and falls back to "en".
  returnEmptyString: false,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
