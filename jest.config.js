// Date tests encode the user's zone (Europe/Warsaw, UTC+1/+2): a local-midnight Date there crosses
// into the previous UTC day. Pinned so the suite gives the same answer on a laptop and in UTC CI.
// Set here, before Jest starts its workers, which inherit it.
process.env.TZ = 'Europe/Warsaw';

module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
};
