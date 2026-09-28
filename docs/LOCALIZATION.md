# Localization

UI strings live in [`src/i18n/locales/en.json`](../src/i18n/locales/en.json), which is
the source of truth. Other locale files (e.g. `uk-UA.json`) start out with empty string
values; [`src/i18n/index.ts`](../src/i18n/index.ts) treats an empty value as "not yet
translated" and falls back to English for it, so a partially-translated locale never
shows blank text.

Translations are managed through [Tolgee](https://tolgee.io), an open-source
translation management platform, via [`@tolgee/cli`](https://docs.tolgee.io/tolgee-cli).
The same setup works against the app.tolgee.io cloud or a
[self-hosted](https://tolgee.io/self-hosting) instance.

The stack is [i18next](https://www.i18next.com/) + [react-i18next](https://react.i18next.com/),
with [expo-localization](https://docs.expo.dev/versions/latest/sdk/localization/) for the
device's language — the same approach as
[what-did-i-eat](https://github.com/mkloouo/what-did-i-eat).

## Syncing strings

The CLI is configured in [`tolgee.config.js`](../tolgee.config.js) at the repo root, and
reads its instance URL and credentials only from a gitignored `.env.local` at the repo
root (not from the shell environment):

```sh
# .env.local
TOLGEE_URL=https://tolgee.example.com
TOLGEE_API_KEY=tgpak_xxxxxxxxxxxxxxxxxxxxxxxx
TOLGEE_PROJECT_ID=1
```

- `TOLGEE_URL` — base URL of your Tolgee instance
- `TOLGEE_API_KEY` — a project API key (`tgpak_…`) or personal access token (`tgpat_…`)
- `TOLGEE_PROJECT_ID` — the numeric project ID (required with a personal access token; a
  project API key already implies it)

With those set:

```sh
npm run i18n:push   # upload src/i18n/locales/en.json's keys to Tolgee
npm run i18n:pull   # download translated strings back into src/i18n/locales/
```

## Adding a new UI string

1. Add the key and its English text to `src/i18n/locales/en.json`. Counts use i18next's
   plural suffixes (`key_one` / `key_other`, and `_few` / `_many` where a language needs
   them — Tolgee handles those per language).
2. Add the same key with an empty string value to every other locale file (so it falls
   back to English until translated). `src/i18n/locales.test.ts` fails if the key sets drift.
3. In a component, use `useTranslation()` from `react-i18next`. Screens already call the
   theme `t` (`const t = useTheme()`), so the translate function is named `tr`:
   `const { t: tr } = useTranslation();` then `tr('namespace.key')`. Outside React (helpers
   like `src/ui/relativeTime.ts`), import `i18n` from `src/i18n` and call `i18n.t(...)`.
4. Dates and times: pass `appLocale()` from `src/i18n` to `toLocaleDateString` & co., never
   `undefined`, so they follow the app's language rather than the device's.
5. Run `npm run i18n:push` so the new key shows up in Tolgee for translation.

What stays untranslated on purpose: data that leaves the phone or comes from Firefly III
(transaction descriptions such as "Cash count", category and account names), and internal
error text written to the Diagnostics log.

## Adding a new language

1. Add the locale to `resources` in `src/i18n/index.ts` and to the `AppLocale` type there.
2. Create `src/i18n/locales/<code>.json` with the same keys as `en.json`, values empty.
3. Add the locale to Tolgee (project settings) and to `pull.languages` in
   `tolgee.config.js`, then `npm run i18n:pull`.
4. Add it to `LOCALES` in `src/settings/appSettings.ts` and to `LANGUAGE_OPTIONS` on the
   Settings screen (`app/(tabs)/settings.tsx`) so people can pick it manually.

Optionally, install [Tolgee's GitHub integration](https://docs.tolgee.io/platform/integrations/version_control_systems/github_actions)
to open a pull request automatically when translations change.

## Manual language switch

People aren't limited to their device's language: Settings → Language offers System /
English / Українська, stored as `locale` in the `app_settings` table (default `"system"`).
`src/i18n/LocaleSync.tsx`, mounted inside `DbProvider`, live-queries that value and calls
`i18n.changeLanguage()` — resolving the device's language itself when the setting is
`"system"`, via the same matching logic `src/i18n/index.ts` uses at startup.
