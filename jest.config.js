// Date tests encode the user's zone (Europe/Warsaw, UTC+1/+2): a local-midnight Date there crosses
// into the previous UTC day. Pinned so the suite gives the same answer on a laptop and in UTC CI.
// Set here, before Jest starts its workers, which inherit it.
process.env.TZ = 'Europe/Warsaw';

// The preset transforms `.js`/`.ts` but not `.mjs`, so a `scripts/*.mjs` imported by a test is
// handed to Node as-is and dies on its first `import`. Same transform, one more extension.
const preset = require('jest-expo/jest-preset');

module.exports = {
  preset: 'jest-expo',
  transform: { ...preset.transform, '\\.mjs$': preset.transform['\\.[jt]sx?$'] },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
  // `npm run test:coverage` (CI): the code that moves money must not lose its tests. The floors sit
  // a little under what the suite covers today; raise them when the number does.
  collectCoverageFrom: [
    'src/sync/**/*.ts',
    'src/inbox/**/*.ts',
    'src/splits/**/*.ts',
    'src/api/ff3/decimal.ts',
    '!**/*.test.ts',
  ],
  coverageReporters: ['text-summary'],
  coverageThreshold: {
    './src/sync/': { lines: 80, branches: 75 },
    './src/inbox/': { lines: 80, branches: 68 },
    './src/splits/': { lines: 55, branches: 38 },
    './src/api/ff3/decimal.ts': { lines: 95, branches: 88 },
  },
};
