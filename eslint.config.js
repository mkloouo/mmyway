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

// AGENTS.md: payload_json/draft_json only through their zod-validated readers and writers.
const JSON_COLUMNS = [
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
  {
    selector:
      "TSAsExpression > CallExpression[callee.object.name='JSON'][callee.property.name='parse']",
    message: "Validate with zod, don't cast.",
  },
];

const MAX_LINES = 400;
// Ceilings, in lines of code, for the files that were already too big (2026-10-13).
const OVERSIZED = {
  'app/capture.tsx': 1344,
  'app/draft/[[]id].tsx': 983,
  'app/transactions/[[]groupId].tsx': 942,
  'app/count.tsx': 682,
  'app/(tabs)/activity.tsx': 680,
  'app/(tabs)/index.tsx': 571,
  'app/accounts/new.tsx': 499,
  'src/planned/notifications.ts': 469,
  'src/ui/InboxCards.tsx': 459,
  'app/accounts/[[]id].tsx': 404,
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.maestro/**', 'src/db/migrations/**', 'src/api/ff3/types.ts'],
  },
  {
    // Promises: an async handler's failure must reach useAction()/the log, not vanish.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: TESTS,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
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
      'no-restricted-syntax': ['error', ...JSON_COLUMNS],
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
    files: ['eslint.config.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        module: 'readonly',
        require: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    // No file grows into a dump (docs/UI_KIT.md § File size): 400 lines of code at most.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: TESTS,
    rules: { 'max-lines': ['error', { max: MAX_LINES, skipBlankLines: true, skipComments: true }] },
  },
  // Files already over the limit are pinned at today's size: they may shrink, never grow. Lower a
  // number when a file shrinks; drop its entry once it is under MAX_LINES. Never raise one.
  ...Object.entries(OVERSIZED).map(([file, max]) => ({
    files: [file],
    rules: { 'max-lines': ['error', { max, skipBlankLines: true, skipComments: true }] },
  })),
  {
    // Colours come from the theme (src/ui/theme.ts), never a literal (docs/UI_KIT.md).
    files: ['app/**/*.tsx', 'src/**/*.tsx'],
    ignores: TESTS,
    rules: {
      // Restates JSON_COLUMNS: a later block's no-restricted-syntax replaces the earlier one.
      'no-restricted-syntax': [
        'error',
        ...JSON_COLUMNS,
        {
          selector: 'Literal[value=/^(#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\()/]',
          message:
            'Use a colour token from useTheme().color; add one to src/ui/theme.ts if missing.',
        },
      ],
    },
  },
  {
    // Sizes and spacing come from the theme (src/ui/theme.ts), never a literal (docs/UI_KIT.md, MKL-81).
    files: ['app/**/*.tsx'],
    ignores: TESTS,
    rules: {
      // Restates JSON_COLUMNS and color selector: a later block's no-restricted-syntax replaces earlier ones.
      'no-restricted-syntax': [
        'error',
        ...JSON_COLUMNS,
        {
          selector: 'Literal[value=/^(#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\()/]',
          message:
            'Use a colour token from useTheme().color; add one to src/ui/theme.ts if missing.',
        },
        {
          selector:
            'Property[key.name=/^(fontSize|lineHeight|padding.*|margin.*|gap|borderRadius)$/] > Literal[value>1]',
          message:
            'Use a size token from useTheme() (t.space, t.radius, t.type), not a bare numeric literal.',
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
          mode: 'jsx-only',
          'jsx-attributes': {
            include: ['placeholder', 'title', 'label', 'accessibilityLabel'],
          },
          words: { exclude: ["^[\\s0-9+\\-\\u00D7\\u2000-\\u2BFF\\uD800-\\uDFFF—–·•{}' ]+$"] },
        },
      ],
    },
  },
  {
    // Kit V2: screens do not use raw input/pressable primitives or query drizzle directly (MKL-87).
    files: ['app/**/*.{ts,tsx}'],
    ignores: TESTS,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: [
                'Pressable',
                'TouchableOpacity',
                'TouchableHighlight',
                'TextInput',
                'Modal',
              ],
              message: 'Use the kit (docs/UI_KIT.md §3)',
            },
            {
              name: 'drizzle-orm',
              message: 'Read through a useXxx() hook in src/<domain>/ (docs/UI_KIT.md §4)',
            },
          ],
          patterns: [
            {
              group: ['**/testDb', '**/db/testDb'],
              message:
                'testDb pulls node:crypto/node:fs into the Android bundle (AGENTS.md). Only tests import it.',
            },
            {
              group: ['drizzle-orm/**', '**/db/schema*'],
              message: 'Read through a useXxx() hook in src/<domain>/ (docs/UI_KIT.md §4)',
            },
          ],
        },
      ],
    },
  },
  {
    // Domain code must not depend on the UI layer (MKL-120).
    files: ['src/**/*.ts'],
    ignores: [...TESTS, 'src/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/ui',
                '**/ui/**',
                '../ui',
                '../ui/**',
                '../../ui',
                '../../ui/**',
                'src/ui',
                'src/ui/**',
              ],
              message: "Domain code doesn't depend on the UI kit",
            },
          ],
        },
      ],
    },
  },
]);
