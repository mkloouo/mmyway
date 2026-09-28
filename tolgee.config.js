// Config for @tolgee/cli (`npm run i18n:push` / `npm run i18n:pull`).
// Docs: https://docs.tolgee.io/tolgee-cli/project-configuration
//
// Instance URL and credentials are read only from the gitignored
// `.env.local` (see docs/LOCALIZATION.md), so this file is safe to commit:
//
//   TOLGEE_URL          Base URL of the Tolgee instance.
//   TOLGEE_API_KEY      Project API key (tgpak_…) or personal access token (tgpat_…).
//   TOLGEE_PROJECT_ID   Numeric project ID.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { parseEnv } = require('node:util');

const envPath = join(__dirname, '.env.local');
let env;
try {
  env = parseEnv(readFileSync(envPath, 'utf8'));
} catch {
  throw new Error(`Tolgee: ${envPath} not found — see docs/LOCALIZATION.md`);
}

module.exports = {
  apiUrl: env.TOLGEE_URL,
  apiKey: env.TOLGEE_API_KEY,
  projectId: env.TOLGEE_PROJECT_ID ? Number(env.TOLGEE_PROJECT_ID) : undefined,
  format: 'JSON_I18NEXT',
  push: {
    filesTemplate: 'src/i18n/locales/{languageTag}.json',
    languages: ['en'],
  },
  pull: {
    path: 'src/i18n/locales',
    languages: ['uk-UA'],
  },
};
