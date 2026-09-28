// expo-crypto needs the native module, unavailable under Jest (node). Jest auto-loads this file
// for any `require('expo-crypto')` in tests; real builds use the real one.
module.exports = {
  randomUUID: () => require('node:crypto').randomUUID(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm, data) =>
    require('node:crypto').createHash('sha256').update(data).digest('hex'),
};
