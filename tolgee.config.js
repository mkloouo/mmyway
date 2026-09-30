// Config for @tolgee/cli (`npm run i18n:push` / `npm run i18n:pull`).
// Docs: https://docs.tolgee.io/tolgee-cli/project-configuration

require('dotenv').config({ path: '.env.local' });

module.exports = {
  apiUrl: process.env.TOLGEE_URL,
  apiKey: process.env.TOLGEE_API_KEY,
  projectId: process.env.TOLGEE_PROJECT_ID ? Number(process.env.TOLGEE_PROJECT_ID) : undefined,
  format: 'JSON_I18NEXT',
  push: {
    filesTemplate: 'src/i18n/locales/{languageTag}.json',
    languages: ['en'],
  },
  pull: {
    path: 'src/i18n/locales',
    languages: ['en', 'uk-UA'],
  },
};
