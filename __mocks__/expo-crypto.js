// expo-crypto's randomUUID() needs the native module, unavailable under Jest (node). Jest
// auto-loads this file for any `require('expo-crypto')` in tests; real builds use the real one.
module.exports = {
  randomUUID: () => require('node:crypto').randomUUID(),
};
