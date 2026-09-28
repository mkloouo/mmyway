# Changelog

## [Unreleased]

### Changed
- Release builds can reach Firefly III and the local receipt model at plain `http://`
  addresses (a LAN IP, a tailnet name); before, only debug builds could.
- Much smaller Android downloads: the production profile now emits one APK per CPU
  architecture (arm64-v8a, armeabi-v7a, x86, x86_64) plus a universal APK, instead of a single
  APK carrying all four. Release builds also shrink code with R8 and compress native libraries.
- The bundle only includes the Ionicons font the app actually uses, instead of all 19 icon
  fonts `@expo/vector-icons`' package root re-exports.

### Added
- Initial scaffold: Expo/expo-router project, Drizzle SQLite schema, FF3 client (auth,
  timezone, decimal helpers), offline outbox/sync engine, lookup/suggest/receipt modules,
  inbox state machine, and generic Inbox/Draft/Transactions/Settings/Recurring screens.
