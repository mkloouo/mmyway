// https://docs.expo.dev/guides/using-eslint/
// Expo's rules, plus type-aware promise rules and AGENTS.md's rules as code.
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const i18next = require('eslint-plugin-i18next');
const expoConfig = require('eslint-config-expo/flat');

const TESTS = [
  '**/*.test.ts',
  '**/*.test.tsx',
  'src/__screens__/**',
  'src/__smoke__/**',
  'src/db/testDb.ts',
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/*',
      'scripts/release-test-stubs/**',
      '.maestro/**',
      'src/db/migrations/**',
      'src/api/ff3/types.ts',
    ],
  },
  {
    // Promises: an async handler's failure must reach useAction()/the log, not vanish.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: TESTS,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
  {
    // AGENTS.md, as rules.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: [...TESTS, 'src/sync/payloadJson.ts', 'src/inbox/draftJson.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='JSON'][callee.property.name='parse'] > MemberExpression[property.name=/^(payloadJson|draftJson)$/]",
          message:
            'Read payload_json/draft_json through src/sync/payloadJson.ts or src/inbox/draftJson.ts (zod-validated, versioned), never JSON.parse.',
        },
        {
          selector:
            "Property[key.name=/^(payloadJson|draftJson)$/] > CallExpression[callee.object.name='JSON'][callee.property.name='stringify']",
          message:
            'Write payload_json/draft_json with writePayload()/writeDraft(), which stamp the version.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'FF3 amounts are strings: use src/api/ff3/decimal.ts.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Number',
          property: 'parseFloat',
          message: 'FF3 amounts are strings: use src/api/ff3/decimal.ts.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/testDb', '**/db/testDb'],
              message:
                'testDb pulls node:crypto/node:fs into the Android bundle (AGENTS.md). Only tests import it.',
            },
          ],
        },
      ],
    },
  },
  {
    // No user-visible string hardcoded in a screen or component (docs/LOCALIZATION.md).
    files: ['app/**/*.tsx', 'src/ui/**/*.tsx'],
    ignores: TESTS,
    plugins: { i18next },
    rules: {
      // Glyphs, digits and emoji (▾ ✓ ✕ × 🧮 1 ≈) aren't words to translate.
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-text-only',
          words: { exclude: ["^[\\s0-9\\u00D7\\u2000-\\u2BFF\\uD800-\\uDFFF—–·•{}' ]+$"] },
        },
      ],
    },
  },
]);
